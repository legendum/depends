import legendum from "../vendor/legendum/legendum.js";
import { issueFromError } from "./charge";
import { getTabSpec } from "./config";
import type {
  BillingResult,
  BillingTab,
  BillingTabs,
  TabChannel,
} from "./types";

type SubjectKey = string;

function toSubjectKey(subject: string | number): SubjectKey {
  return String(subject);
}

/** Internal: one tab bound to the token it was created with. Rotation safety
 *  (rebinding when the token changes) lives in `createTabs` — which is why
 *  this is not exported: a token-bound tab held across logins charges a dead
 *  token and severs a live link. */
function createTab(args: {
  subject: string | number;
  accountToken: string | null;
  description: string;
  threshold: number;
  defaultAmount?: number;
  onTokenInvalid?: (subject: string | number) => void | Promise<void>;
}): BillingTab {
  let tab: {
    add(amount?: number): Promise<void>;
    flush(): Promise<void>;
    close(): Promise<void>;
  } | null = null;

  function ensureTab() {
    if (!args.accountToken || tab) return;
    tab = legendum.tab(args.accountToken, args.description, {
      threshold: args.threshold,
      ...(typeof args.defaultAmount === "number"
        ? { amount: args.defaultAmount }
        : {}),
    });
  }

  async function onTokenInvalid() {
    if (args.onTokenInvalid) {
      await args.onTokenInvalid(args.subject);
    }
  }

  return {
    add: async (amount?: number): Promise<BillingResult<null>> => {
      if (!args.accountToken) return { ok: true, value: null };
      ensureTab();
      try {
        await tab!.add(amount);
        return { ok: true, value: null };
      } catch (err) {
        const issue = issueFromError(err);
        if (issue.code === "token_not_found") {
          tab = null;
          await onTokenInvalid();
        }
        return { ok: false, issue };
      }
    },
    flush: async () => {
      if (!tab) return;
      try {
        await tab.flush();
      } catch {
        // best-effort flush
      }
    },
    close: async () => {
      if (!tab) return;
      const current = tab;
      tab = null;
      try {
        await current.close();
      } catch {
        // best-effort close
      }
    },
  };
}

/** `createTabs` with channels read from `config/pues.yaml` `billing.tabs` —
 *  one channel per name. */
export function createTabsFromConfig(args: {
  names: string[];
  root?: string;
  onTokenInvalid?: (subject: string | number) => void | Promise<void>;
}): BillingTabs {
  const channels: Record<string, TabChannel> = {};
  for (const name of args.names) {
    const spec = getTabSpec(name, args.root);
    channels[name] = {
      description: spec.description,
      threshold: spec.threshold,
      defaultAmount: spec.default_amount,
    };
  }
  return createTabs({ channels, onTokenInvalid: args.onTokenInvalid });
}

export function createTabs(args: {
  channels: Record<string, TabChannel>;
  onTokenInvalid?: (subject: string | number) => void | Promise<void>;
}): BillingTabs {
  // Each entry remembers the token its tab was built with, so `add` can detect
  // rotation (a re-link mints a fresh token and kills the old one at Legendum).
  type TabEntry = { tab: BillingTab; token: string | null };
  const bySubject = new Map<SubjectKey, Map<string, TabEntry>>();

  function getChannel(name: string): TabChannel {
    const channel = args.channels[name];
    if (!channel) {
      throw new Error(`[pues/billing] unknown tab channel: ${name}`);
    }
    return channel;
  }

  function getOrCreateTab(params: {
    channel: string;
    subject: string | number;
    accountToken: string | null;
  }): BillingTab {
    const key = toSubjectKey(params.subject);
    const subjectTabs = bySubject.get(key) ?? new Map<string, TabEntry>();
    if (!bySubject.has(key)) bySubject.set(key, subjectTabs);
    const existing = subjectTabs.get(params.channel);
    if (existing) return existing.tab;

    const c = getChannel(params.channel);
    const created = createTab({
      subject: params.subject,
      accountToken: params.accountToken,
      description: c.description,
      threshold: c.threshold,
      defaultAmount: c.defaultAmount,
      onTokenInvalid: args.onTokenInvalid,
    });
    subjectTabs.set(params.channel, {
      tab: created,
      token: params.accountToken,
    });
    return created;
  }

  async function forEachSelected(
    selected: { subject?: string | number; channel?: string } | undefined,
    fn: (tab: BillingTab, key: SubjectKey, channel: string) => Promise<void>,
  ): Promise<void> {
    const subjects = selected?.subject
      ? [toSubjectKey(selected.subject)]
      : [...bySubject.keys()];
    for (const key of subjects) {
      const subjectTabs = bySubject.get(key);
      if (!subjectTabs) continue;
      const channels = selected?.channel
        ? [selected.channel]
        : [...subjectTabs.keys()];
      for (const channel of channels) {
        const entry = subjectTabs.get(channel);
        if (!entry) continue;
        await fn(entry.tab, key, channel);
      }
    }
  }

  return {
    add: async ({ channel, subject, accountToken, amount }) => {
      // Rebind on token rotation: the caller reads the CURRENT token from its
      // DB, but a tab charges with the token it was born with — after a
      // re-link (new device login) that token is dead at Legendum, the flush
      // would come back token_not_found, and onTokenInvalid would sever a
      // link that is actually alive (POLS). Close the stale tab best-effort
      // (its flush can only fail against the dead token; sub-threshold
      // credits are forfeited, never overcharged) and start fresh on the
      // current token. token_not_found then only ever means the current
      // token is genuinely dead — exactly when clearing the link is right.
      const key = toSubjectKey(subject);
      const existing = bySubject.get(key)?.get(channel);
      if (existing && existing.token !== accountToken) {
        await existing.tab.close();
        bySubject.get(key)?.delete(channel);
      }
      const tab = getOrCreateTab({ channel, subject, accountToken });
      return tab.add(amount);
    },
    flush: async (selected) => {
      await forEachSelected(selected, async (tab) => {
        await tab.flush();
      });
    },
    close: async (selected) => {
      await forEachSelected(selected, async (tab, key, channel) => {
        await tab.close();
        const subjectTabs = bySubject.get(key);
        if (!subjectTabs) return;
        subjectTabs.delete(channel);
        if (subjectTabs.size === 0) bySubject.delete(key);
      });
    },
    closeAll: async () => {
      for (const [key, subjectTabs] of bySubject) {
        for (const [channel, entry] of subjectTabs) {
          await entry.tab.close();
          subjectTabs.delete(channel);
        }
        bySubject.delete(key);
      }
    },
  };
}
