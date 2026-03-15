import nodemailer from "nodemailer";
import { Eta } from "eta";
import { join } from "path";
import type { WebhookPayload } from "./webhook";

const transporter =
  process.env.SMTP_HOST
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT ?? "465", 10),
        secure: true,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      })
    : null;

const from = process.env.SMTP_FROM ?? "notifications@depends.cc";

const eta = new Eta({ views: join(import.meta.dir, "../../views/emails"), autoTrim: false });

function render(template: string, data: Record<string, unknown>): string {
  return eta.render(template, data);
}

export async function sendSignupEmail(
  to: string,
  token: string
): Promise<void> {
  if (!transporter) {
    console.error("[email] SMTP not configured, skipping signup email to", to);
    return;
  }

  try {
    await transporter.sendMail({
      from,
      to,
      subject: "Your depends.cc API token",
      html: render("signup", { token }),
    });
  } catch (err) {
    console.error("[email] Failed to send signup email to", to, err);
  }
}

export async function sendEmail(
  to: string,
  payload: WebhookPayload
): Promise<void> {
  if (!transporter) {
    console.error("[email] SMTP not configured, skipping email to", to);
    return;
  }

  const stateEmoji =
    payload.state === "red" ? "\u{1F534}" :
    payload.state === "yellow" ? "\u{1F7E1}" : "\u{1F7E2}";

  const subject = `${stateEmoji} ${payload.node_id} is ${payload.state} [${payload.namespace}]`;

  try {
    await transporter.sendMail({
      from,
      to,
      subject,
      html: render("notification", payload),
    });
  } catch (err) {
    console.error("[email] Failed to send to", to, err);
  }
}
