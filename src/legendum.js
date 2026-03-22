/**
 * Legendum SDK for JavaScript/TypeScript
 * Zero dependencies — uses global fetch.
 *
 * Usage:
 *   const legendum = require('legendum-sdk')
 *   // or: import legendum from './legendum.js'
 *
 * Configuration (environment variables):
 *   LEGENDUM_API_KEY  — service API key (lpk_...)
 *   LEGENDUM_SECRET   — service secret  (lsk_...)
 *   LEGENDUM_BASE_URL — base URL (default: https://legendum.co.uk)
 *
 * Or pass config to create():
 *   const client = legendum.create({ apiKey, secret, baseUrl })
 *
 * Error handling:
 *   All methods throw on failure. The error object has:
 *     err.message — human-readable description (e.g. "Account balance is 50 but charge requires 100")
 *     err.code    — machine-readable code (e.g. "insufficient_funds")
 *     err.status  — HTTP status code (e.g. 402)
 *
 *   Error codes:
 *     "unauthorized"        (401) — missing or invalid API key / secret
 *     "bad_request"         (400) — missing required fields or invalid values
 *     "token_not_found"     (404) — account token not found or inactive
 *     "insufficient_funds"  (402) — balance too low for the charge or reservation
 *     "invalid_state"       (409) — reservation is not in 'held' state
 *     "expired"             (410) — reservation has expired
 *     "link_expired"        (410) — pairing code has expired
 *     "not_found"           (404) — pairing code not found
 *     "invalid_code"        (400) — wrong email confirmation code
 *
 *   Example:
 *     try {
 *       await client.charge(token, 100, "API call");
 *     } catch (err) {
 *       if (err.code === "insufficient_funds") {
 *         // prompt user to buy more credits
 *       }
 *     }
 *
 * Testing:
 *   legendum.mock({
 *     charge: (token, amount, desc) => ({ transaction_id: 1, balance: 50 }),
 *   });
 *   // isConfigured() returns true, all methods use mock handlers
 *   legendum.unmock();
 */

function create(config) {
  const baseUrl = (config && config.baseUrl) || env("LEGENDUM_BASE_URL") || "https://legendum.co.uk";
  const apiKey = (config && config.apiKey) || env("LEGENDUM_API_KEY");
  const secret = (config && config.secret) || env("LEGENDUM_SECRET");

  if (!apiKey || !secret) {
    throw new Error("Legendum SDK: LEGENDUM_API_KEY and LEGENDUM_SECRET are required");
  }

  var base = baseUrl.replace(/\/+$/, "");

  function env(name) {
    if (typeof process !== "undefined" && process.env) return process.env[name];
    return undefined;
  }

  function headers(json) {
    var h = {
      "X-API-Key": apiKey,
      "Authorization": "Bearer " + secret,
    };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  async function request(method, path, body) {
    var opts = { method: method, headers: headers(!!body) };
    if (body) opts.body = JSON.stringify(body);
    var res = await fetch(base + path, opts);
    var data = await res.json();
    if (!data.ok) {
      var err = new Error(data.message || data.error || "Legendum API error");
      err.code = data.error;
      err.status = res.status;
      throw err;
    }
    return data.data;
  }

  return {
    /**
     * Charge credits from a linked account.
     * @param {string} accountToken - The account_service token
     * @param {number} amount - Credits to charge (positive integer)
     * @param {string} description - Human-readable description
     * @param {object} [opts] - Optional: { key, meta }
     * @returns {Promise<{ transaction_id: number, balance: number }>}
     */
    async charge(accountToken, amount, description, opts) {
      var body = {
        account_token: accountToken,
        amount: amount,
        description: description,
      };
      if (opts && opts.key) body.key = opts.key;
      if (opts && opts.meta) body.meta = opts.meta;
      return request("POST", "/api/charge", body);
    },

    /**
     * Get balance for a linked account.
     * @param {string} accountToken - The account_service token
     * @returns {Promise<{ balance: number, held: number }>}
     */
    async balance(accountToken) {
      return request("GET", "/api/balance?token=" + encodeURIComponent(accountToken));
    },

    /**
     * Reserve credits (hold for up to 15 minutes).
     * @param {string} accountToken - The account_service token
     * @param {number} amount - Credits to reserve
     * @param {string} [description] - Optional description
     * @returns {Promise<Reservation>}
     */
    async reserve(accountToken, amount, description) {
      var body = { account_token: accountToken, amount: amount };
      if (description) body.description = description;
      var data = await request("POST", "/api/reserve", body);
      return {
        id: data.reservation_id,
        amount: amount,
        /**
         * Settle the reservation (finalise the charge).
         * @param {number} [settleAmount] - Amount to settle (defaults to reserved amount)
         */
        async settle(settleAmount) {
          return request("POST", "/api/settle", {
            reservation_id: data.reservation_id,
            amount: settleAmount,
          });
        },
        /**
         * Release the reservation (cancel, no charge).
         */
        async release() {
          return request("POST", "/api/release", {
            reservation_id: data.reservation_id,
          });
        },
      };
    },

    /**
     * Request a pairing code for account linking.
     * @returns {Promise<{ code: string, request_id: string }>}
     */
    async requestLink() {
      return request("POST", "/api/link", {});
    },

    /**
     * Poll for a link request result.
     * @param {string} requestId - The request_id from requestLink()
     * @returns {Promise<{ status: string, account_token?: string }>}
     */
    async pollLink(requestId) {
      return request("GET", "/api/link/" + encodeURIComponent(requestId));
    },

    /**
     * Build a "Login with Legendum" authorize URL.
     * Redirect the user's browser here to start the auth flow.
     * @param {object} opts
     * @param {string} opts.redirectUri - Your callback URL (must be registered)
     * @param {string} opts.state - CSRF token (opaque string, returned unchanged)
     * @returns {string} The authorize URL
     */
    authUrl(opts) {
      return base + "/auth/authorize?client_id=" + encodeURIComponent(apiKey)
        + "&redirect_uri=" + encodeURIComponent(opts.redirectUri)
        + "&state=" + encodeURIComponent(opts.state);
    },

    /**
     * Exchange a one-time auth code for user info.
     * Call this server-side in your callback handler.
     * @param {string} code - The code from the redirect query string
     * @param {string} redirectUri - Must match the original authorize request
     * @returns {Promise<{ email: string, account_id: string, linked: boolean }>}
     */
    async exchangeCode(code, redirectUri) {
      return request("POST", "/api/auth/token", { code: code, redirect_uri: redirectUri });
    },

    /**
     * Link an agent's Legendum account to this service.
     * The agent provides their account key (lak_...), and this creates
     * the account-service link, returning a token for charging.
     * @param {string} accountKey - The agent's account key (lak_...)
     * @returns {Promise<{ token: string }>}
     */
    async linkAgent(accountKey) {
      return request("POST", "/api/agent/link-service", { api_key: apiKey, secret: secret, account_key: accountKey });
    },

    /**
     * Poll until link is confirmed or expired.
     * @param {string} requestId - The request_id from requestLink()
     * @param {object} [opts] - { interval: ms (default 2000), timeout: ms (default 600000) }
     * @returns {Promise<{ account_token: string }>}
     */
    async waitForLink(requestId, opts) {
      var interval = (opts && opts.interval) || 2000;
      var timeout = (opts && opts.timeout) || 600000;
      var deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        var result = await this.pollLink(requestId);
        if (result.status === "confirmed") return result;
        if (result.status === "expired") {
          var err = new Error("Link request expired");
          err.code = "link_expired";
          throw err;
        }
        await new Promise(function (r) { setTimeout(r, interval); });
      }
      var err2 = new Error("Link polling timed out");
      err2.code = "timeout";
      throw err2;
    },
  };
}

/**
 * Create an agent client for account-holder operations.
 * Uses an account key (lak_...) to act on behalf of a human user.
 *
 * @param {string} accountKey - The agent's account key (lak_...)
 * @param {object} [config] - { baseUrl }
 * @returns {object} Agent client with balance(), transactions(), link(), unlink() methods
 *
 * Example:
 *   const agent = legendum.agent('lak_...');
 *   const { balance } = await agent.balance();
 *   await agent.link('ABC123');
 */
function agent(accountKey, config) {
  var baseUrl = (config && config.baseUrl) || env("LEGENDUM_BASE_URL") || "https://legendum.co.uk";
  var base = baseUrl.replace(/\/+$/, "");

  function env(name) {
    if (typeof process !== "undefined" && process.env) return process.env[name];
    return undefined;
  }

  function headers(json) {
    var h = { "Authorization": "Bearer " + accountKey };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  async function request(method, path, body) {
    var opts = { method: method, headers: headers(!!body) };
    if (body) opts.body = JSON.stringify(body);
    var res = await fetch(base + path, opts);
    var data = await res.json();
    if (!data.ok) {
      var err = new Error(data.message || data.error || "Legendum API error");
      err.code = data.error;
      err.status = res.status;
      throw err;
    }
    return data.data;
  }

  return {
    /** Get account balance and linked services. */
    async balance() {
      return request("GET", "/api/agent/balance");
    },

    /** Get recent transactions. @param {number} [limit=20] */
    async transactions(limit) {
      return request("GET", "/api/agent/transactions?limit=" + (limit || 20));
    },

    /** Link to a service using a pairing code. @param {string} code */
    async link(code) {
      return request("POST", "/api/agent/link", { code: code });
    },

    /** Unlink from a service. @param {string} domain */
    async unlink(domain) {
      return request("DELETE", "/api/agent/link/" + encodeURIComponent(domain));
    },

    /**
     * Authorize with a third-party service (Login with Legendum, no browser).
     * @param {object} opts - { clientId, redirectUri, state }
     * @returns {Promise<{ code: string, redirect_uri: string, state: string }>}
     */
    async authorize(opts) {
      return request("POST", "/api/agent/authorize", {
        client_id: opts.clientId,
        redirect_uri: opts.redirectUri,
        state: opts.state,
      });
    },
  };
}

/**
 * Generate HTML for a "Buy Legendum Credits" button.
 * @param {object} [opts] - { url, label, target }
 * @returns {string} HTML string
 */
function button(opts) {
  var href = (opts && opts.url) || "https://legendum.co.uk/account";
  var label = (opts && opts.label) || "Buy Credits";
  var target = (opts && opts.target) || "_blank";
  return '<a href="' + href + '" target="' + target + '" style="display:inline-flex;align-items:center;gap:0.5rem;background:rgb(88,54,136);color:white;padding:0.6rem 1.2rem;border-radius:4px;text-decoration:none;font-size:1rem;font-family:system-ui,-apple-system,sans-serif;">'
    + '<span style="display:inline-flex;align-items:center;justify-content:center;width:1.5em;height:1.5em;border-radius:50%;background:rgb(88,176,209);color:white;font-weight:bold;font-size:0.9em;">&#x2C60;</span>'
    + label + '</a>';
}

/**
 * Generate HTML + JS for the full Legendum linking widget.
 * Drop this into any page to let users link their Legendum account.
 *
 * @param {object} opts
 * @param {string} [opts.mountAt]   - Prefix used with middleware() — auto-sets linkUrl, confirmUrl, statusUrl
 * @param {string} [opts.linkUrl]    - Your backend endpoint to start linking (POST, returns { ok, code, request_id })
 * @param {string} [opts.confirmUrl] - Your backend endpoint to poll/confirm (POST { request_id }, returns { ok, status })
 * @param {string} [opts.statusUrl]  - Your backend endpoint to check linked state (GET, returns { legendum_linked, balance? })
 * @param {string} [opts.baseUrl]  - Legendum base URL (default: https://legendum.co.uk)
 * @returns {string} HTML string (include directly in page, not via innerHTML)
 */
function linkWidget(opts) {
  var mount = opts.mountAt ? opts.mountAt.replace(/\/+$/, "") : null;
  var linkUrl = opts.linkUrl || (mount && mount + "/link");
  var confirmUrl = opts.confirmUrl || (mount && mount + "/confirm");
  var statusUrl = opts.statusUrl || (mount && mount + "/status") || null;
  var legUrl = (opts.baseUrl || "https://legendum.co.uk").replace(/\/+$/, "");
  var id = "lgw-" + Math.random().toString(36).slice(2, 8);
  var buyBtn = button({ url: legUrl + "/account" });

  return '<div id="' + id + '"></div>'
    + '<style>'
    + '.' + id + '-btn{display:inline-block;background:rgb(88,54,136);color:white;padding:0.5rem 1rem;border-radius:4px;border:none;font-size:1rem;cursor:pointer;text-decoration:none;font-family:system-ui,-apple-system,sans-serif;}'
    + '.' + id + '-btn:hover{background:rgb(68,34,116);}'
    + '.' + id + '-ok{padding:0.75rem 1rem;background:rgba(88,176,209,0.1);border:1px solid rgba(88,176,209,0.4);border-radius:4px;margin-bottom:1rem;}'
    + '.' + id + '-wait{padding:0.75rem 1rem;background:rgba(188,171,122,0.15);border:1px solid rgba(188,171,122,0.4);border-radius:4px;}'
    + '.' + id + '-err{padding:0.75rem 1rem;background:#fef2f2;border:1px solid #fecaca;border-radius:4px;}'
    + '</style>'
    + '<script>'
    + '(function(){'
    + 'var el=document.getElementById("' + id + '");'
    + 'var L="' + legUrl + '";'
    + 'function linked(bal){'
    +   'el.innerHTML=\'' + buyBtn.replace(/'/g, "\\'") + '\';'
    +   'if(typeof bal==="number"){'
    +     'var a=el.querySelector("a");'
    +     'if(a){var s=a.querySelector("span");if(s){s.style.borderRadius="999px";s.style.padding="0.15em 0.6em";s.style.width="auto";s.style.height="auto";s.textContent="\\u2C60 "+bal.toLocaleString();}}'
    +   '}'
    + '}'
    + 'function unlinked(){'
    +   'el.innerHTML=\'<button class="' + id + '-btn" id="' + id + '-sl"><span style="display:inline-flex;align-items:center;justify-content:center;width:1.5em;height:1.5em;border-radius:50%;background:rgb(88,176,209);color:white;font-weight:bold;font-size:0.9em;margin-right:0.5rem;">&#x2C60;</span>Pay with Legendum</button>\';'
    +   'document.getElementById("' + id + '-sl").onclick=doLink;'
    + '}'
    + 'function doLink(){'
    +   'fetch("' + linkUrl + '",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:"{}"})'
    +   '.then(function(r){return r.json();})'
    +   '.then(function(d){'
    +     'if(d.ok&&d.code){'
    +       'el.innerHTML=\'<p class="' + id + '-wait" id="' + id + '-ps">Opening Legendum to link your account…</p>\';'
    +       'poll(d.request_id);'
    +       'window.open(L+"/link?code="+encodeURIComponent(d.code),"_blank");'
    +     '}else{alert(d.message||"Failed to start linking");}'
    +   '}).catch(function(){alert("Connection error");});'
    + '}'
    + 'function poll(rid){'
    +   'var iv=setInterval(function(){'
    +     'fetch("' + confirmUrl + '",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({request_id:rid})})'
    +     '.then(function(r){return r.json();})'
    +     '.then(function(d){'
    +       'if(d.ok&&d.status==="confirmed"){clearInterval(iv);'
    +         (statusUrl
              ? 'fetch("' + statusUrl + '",{credentials:"include"}).then(function(r){return r.ok?r.json():null;}).then(function(s){linked(s&&s.balance);}).catch(function(){linked();});'
              : 'linked();')
    +       '}'
    +       'else if(d.ok&&d.status==="expired"){'
    +         'clearInterval(iv);'
    +         'var ps=document.getElementById("' + id + '-ps");'
    +         'if(ps){ps.className="' + id + '-err";ps.textContent="Code expired. Please try again.";}'
    +         'setTimeout(unlinked,3000);'
    +       '}'
    +     '}).catch(function(){});'
    +   '},3000);'
    +   'setTimeout(function(){clearInterval(iv);},600000);'
    + '}'
    + (statusUrl
      ? 'fetch("' + statusUrl + '",{credentials:"include"}).then(function(r){return r.ok?r.json():null;}).then(function(d){if(d&&d.legendum_linked)linked(d.balance);else unlinked();}).catch(function(){unlinked();});'
      : 'unlinked();')
    + '})();'
    + '</script>';
}

/**
 * Create middleware that handles Legendum linking routes.
 * Works with any server that uses Web Standard Request/Response (Bun, Deno, Cloudflare Workers, etc).
 *
 * @param {object} opts
 * @param {string} [opts.prefix]       - URL prefix for routes (default: "/legendum")
 * @param {function} opts.getToken     - async (request, ...extra) => string|null — return the stored account_token for the current user, or null
 * @param {function} opts.setToken     - async (request, accountToken, ...extra) => void — save the account_token for the current user
 * @param {object} [opts.client]       - SDK client from create(). If omitted, uses default (env vars)
 * @returns {function} async (request, ...extra) => Response|null — returns Response if handled, null if not a Legendum route. Extra args are passed through to callbacks.
 *
 * Routes created:
 *   POST {prefix}/link    — request a pairing code
 *   POST {prefix}/confirm — poll for link confirmation
 *   GET  {prefix}/status  — check linked state and balance
 *
 * Usage with linkWidget:
 *   linkWidget({ mountAt: "/legendum" })
 *   // Automatically sets linkUrl, confirmUrl, statusUrl
 */
function middleware(opts) {
  var prefix = (opts.prefix || "/legendum").replace(/\/+$/, "");
  var getToken = opts.getToken;
  var setToken = opts.setToken;
  var client = opts.client || null;

  function getClient() {
    if (!client) client = create();
    return client;
  }

  function jsonResponse(data, status) {
    return new Response(JSON.stringify(data), {
      status: status || 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  return async function (request) {
    var extra = Array.prototype.slice.call(arguments, 1);
    var url = new URL(request.url);
    var path = url.pathname;

    if (!path.startsWith(prefix + "/") && path !== prefix) return null;
    var route = path.slice(prefix.length);

    // POST /link
    if (route === "/link" && request.method === "POST") {
      try {
        var c = getClient();
        var data = await c.requestLink();
        return jsonResponse({ ok: true, code: data.code, request_id: data.request_id });
      } catch (err) {
        return jsonResponse({ ok: false, message: err.message }, 500);
      }
    }

    // POST /confirm
    if (route === "/confirm" && request.method === "POST") {
      try {
        var body = await request.json();
        if (!body.request_id) return jsonResponse({ ok: false, message: "request_id is required" }, 400);
        var c = getClient();
        var data = await c.pollLink(body.request_id);
        if (data.status === "confirmed" && data.account_token) {
          await setToken.apply(null, [request, data.account_token].concat(extra));
          return jsonResponse({ ok: true, status: "confirmed" });
        }
        return jsonResponse({ ok: true, status: data.status });
      } catch (err) {
        return jsonResponse({ ok: false, message: err.message }, err.status || 500);
      }
    }

    // GET /status
    if (route === "/status" && request.method === "GET") {
      var token = await getToken.apply(null, [request].concat(extra));
      if (!token) return jsonResponse({ legendum_linked: false });
      try {
        var c = getClient();
        var data = await c.balance(token);
        return jsonResponse({ legendum_linked: true, balance: data.balance });
      } catch (err) {
        if (err.code === "token_not_found") {
          return jsonResponse({ legendum_linked: false });
        }
        return jsonResponse({ legendum_linked: true });
      }
    }

    return null;
  };
}

/**
 * Wrap a client so that every method returns { ok, data?, error?, code? }
 * instead of throwing on failure.
 * @param {object} [client] - A client from create(). If omitted, uses default (env vars)
 * @returns {object} Safe client with the same methods but non-throwing
 */
function client(client) {
  var c = client || getDefault();
  function wrap(fn) {
    return async function () {
      try {
        var data = await fn.apply(c, arguments);
        return { ok: true, data: data };
      } catch (err) {
        return { ok: false, error: err.message, code: err.code };
      }
    };
  }
  return {
    charge: wrap(c.charge),
    balance: wrap(c.balance),
    reserve: wrap(c.reserve),
    requestLink: wrap(c.requestLink),
    pollLink: wrap(c.pollLink),
    waitForLink: wrap(c.waitForLink),
    authUrl: c.authUrl.bind(c),
    exchangeCode: wrap(c.exchangeCode),
  };
}

/**
 * Create a tab that accumulates micro-charges and flushes when a threshold is reached.
 *
 * @param {string} accountToken - The account_service token
 * @param {string} description - Description for the batched charge
 * @param {object} opts
 * @param {number} opts.threshold - Flush when accumulated total reaches this amount (required)
 * @param {number} [opts.amount=1] - Default amount per add() call
 * @param {object} [opts.client] - SDK client from create(). If omitted, uses default (env vars)
 * @returns {Tab}
 *
 * Example:
 *   const tab = legendum.tab(token, "AI tokens", { threshold: 100 });
 *   tab.add();      // +1
 *   tab.add(5);     // +5
 *   await tab.close(); // flush remainder
 */
function tab(accountToken, description, opts) {
  if (!opts || typeof opts.threshold !== "number" || opts.threshold <= 0) {
    throw new Error("Legendum SDK: tab() requires opts.threshold (positive number)");
  }
  var threshold = opts.threshold;
  var defaultAmount = (opts && opts.amount) || 1;
  var c = (opts && opts.client) || getDefault();
  var total = 0;
  var flushing = null;
  var closed = false;

  async function flush() {
    if (total <= 0) return;
    var amount = total;
    total = 0;
    await c.charge(accountToken, amount, description);
  }

  return {
    /** Current unflushed total. */
    get total() { return total; },

    /**
     * Add to the running total. Flushes automatically when threshold is reached.
     * @param {number} [amount] - Amount to add (defaults to opts.amount, which defaults to 1)
     * @returns {Promise<void>} Resolves after flush if one was triggered
     */
    async add(amount) {
      if (closed) throw new Error("Legendum SDK: tab is closed");
      total += (amount !== undefined ? amount : defaultAmount);
      if (total >= threshold && !flushing) {
        flushing = flush().finally(function() { flushing = null; });
        await flushing;
      }
    },

    /**
     * Flush any remaining balance and close the tab. No further add() calls allowed.
     * @returns {Promise<void>}
     */
    async close() {
      if (closed) return;
      closed = true;
      await flush();
    },
  };
}

// Default instance reads from env
var defaultClient = null;
var _mockClient = null;

function getDefault() {
  if (_mockClient) return _mockClient;
  if (!defaultClient) defaultClient = create();
  return defaultClient;
}

/**
 * Enable mock mode for testing. All SDK methods will use the provided
 * handlers instead of making HTTP calls. isConfigured() returns true.
 *
 * Each handler receives the same arguments as the real method and should
 * return what the real method would (or throw to simulate errors).
 * Unspecified methods return sensible defaults.
 *
 * @param {object} [handlers] - { charge, balance, reserve, requestLink, pollLink, exchangeCode, authUrl }
 *
 * Example:
 *   const legendum = require('./legendum.js');
 *   legendum.mock({
 *     charge: (token, amount, desc) => ({ transaction_id: 1, balance: 50 }),
 *     balance: (token) => ({ balance: 100, held: 0 }),
 *   });
 *   // ... run tests ...
 *   legendum.unmock();
 */
function mockSdk(handlers) {
  var h = handlers || {};
  _mockClient = {
    charge: h.charge || async function () { return { transaction_id: 1, balance: 0 }; },
    balance: h.balance || async function () { return { balance: 0, held: 0 }; },
    reserve: h.reserve || async function (_t, amount) {
      return { id: 1, amount: amount, settle: async function () {}, release: async function () {} };
    },
    requestLink: h.requestLink || async function () { return { code: "MOCK", request_id: "mock_req" }; },
    pollLink: h.pollLink || async function () { return { status: "pending" }; },
    waitForLink: h.waitForLink || async function () { return { account_token: "mock_token" }; },
    authUrl: h.authUrl || function (opts) { return "http://mock.legendum.test/auth/authorize?state=" + (opts && opts.state || ""); },
    exchangeCode: h.exchangeCode || async function () { return { email: "mock@test.com", account_id: "lgd_mock", linked: false }; },
    linkAgent: h.linkAgent || async function () { return { token: "mock_legendum_token" }; },
  };
}

/**
 * Disable mock mode. Restores normal SDK behaviour.
 */
function unmockSdk() {
  _mockClient = null;
}

module.exports = {
  create: create,
  service: create,
  agent: agent,
  client: client,
  isConfigured: function () { if (_mockClient) return true; try { getDefault(); return true; } catch (e) { return false; } },
  charge: function () { return getDefault().charge.apply(getDefault(), arguments); },
  balance: function () { return getDefault().balance.apply(getDefault(), arguments); },
  reserve: function () { return getDefault().reserve.apply(getDefault(), arguments); },
  requestLink: function () { return getDefault().requestLink.apply(getDefault(), arguments); },
  pollLink: function () { return getDefault().pollLink.apply(getDefault(), arguments); },
  waitForLink: function () { return getDefault().waitForLink.apply(getDefault(), arguments); },
  tab: tab,
  authUrl: function (opts) { return getDefault().authUrl(opts); },
  exchangeCode: function () { return getDefault().exchangeCode.apply(getDefault(), arguments); },
  linkAgent: function () { return getDefault().linkAgent.apply(getDefault(), arguments); },
  button: button,
  linkWidget: linkWidget,
  middleware: middleware,
  mock: mockSdk,
  unmock: unmockSdk,
};
