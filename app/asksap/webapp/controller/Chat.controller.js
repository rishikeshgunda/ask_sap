sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel"
], function (Controller, JSONModel) {
  "use strict";

  // Turns the model's plain text into safe HTML: "- " lines become bullets, **x** becomes bold.
  function toHtml(text) {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    const out = [];
    let inList = false;
    String(text || "").split(/\r?\n/).forEach(function (raw) {
      const line = raw.trim();
      const m = /^[-*\u2022]\s+(.*)$/.exec(line);
      if (m) {
        if (!inList) { out.push("<ul>"); inList = true; }
        out.push("<li>" + inline(m[1]) + "</li>");
      } else {
        if (inList) { out.push("</ul>"); inList = false; }
        if (line) { out.push("<p>" + inline(line) + "</p>"); }
      }
    });
    if (inList) { out.push("</ul>"); }
    return out.join("");
  }

  // "query_entity_set" + {"top":5,...} -> readable lines
  function formatCall(t) {
    let args;
    try {
      args = Object.entries(JSON.parse(t.args)).map(function (e) { return e[0] + ": " + e[1]; }).join("\n");
    } catch (e) {
      args = t.args;
    }
    return t.tool + "\n" + args;
  }

  return Controller.extend("com.intraedge.asksap.controller.Chat", {

    onInit: function () {
      this._model = new JSONModel({ messages: [], draft: "", busy: false });
      this.getView().setModel(this._model, "chat");

      // IMPORTANT: a RELATIVE url resolved against the app's own base path.
      //  - Local:       /asksap/webapp/odata/v4/chat/   (srv/server.js maps it to the service)
      //  - HTML5 repo / Work Zone: <app path>/odata/v4/chat/  (xs-app.json routes it to destination srv-api)
      // An absolute "/odata/..." would bypass the app path and give 404 on BTP.
      this._serviceUrl = sap.ui.require.toUrl("com/intraedge/asksap/odata/v4/chat/");
      this._askUrl = this._serviceUrl + "ask";
      this._csrf = null;
    },

    onClear: function () {
      this._model.setProperty("/messages", []);
    },

    // The approuter protects POST requests with a CSRF token (csrfProtection: true in xs-app.json).
    // Fetch it with a GET. Without an approuter (local run) no token comes back and none is needed.
    _getCsrfToken: async function (force) {
      if (this._csrf !== null && !force) { return this._csrf; }
      try {
        const res = await fetch(this._serviceUrl, {
          method: "GET",
          headers: { "X-CSRF-Token": "Fetch", "Accept": "application/json" },
          credentials: "same-origin"
        });
        this._csrf = res.headers.get("X-CSRF-Token") || "";
      } catch (e) {
        this._csrf = "";
      }
      return this._csrf;
    },

    _post: async function (payload, isRetry) {
      const token = await this._getCsrfToken(isRetry);
      const headers = { "Content-Type": "application/json", "Accept": "application/json" };
      if (token && token.toLowerCase() !== "required") { headers["X-CSRF-Token"] = token; }
      const res = await fetch(this._askUrl, {
        method: "POST",
        headers: headers,
        credentials: "same-origin",
        body: JSON.stringify(payload)
      });
      // A 403 can mean an outdated CSRF token: fetch a new one and try once more.
      if (res.status === 403 && !isRetry) { return this._post(payload, true); }
      return res;
    },

    onSend: async function () {
      const text = (this._model.getProperty("/draft") || "").trim();
      if (!text || this._model.getProperty("/busy")) { return; }

      const i18n = this.getView().getModel("i18n").getResourceBundle();
      const messages = this._model.getProperty("/messages").slice();

      // Previous turns sent to the backend as context (placeholders and errors are flagged and skipped).
      const history = messages
        .filter(function (m) { return !m.skip; })
        .slice(-6)
        .map(function (m) { return { role: m.role, content: m.text }; });

      messages.push({ role: "user", text: text });
      messages.push({ role: "assistant", text: "", html: "<p><em>" + i18n.getText("thinking") + "</em></p>", skip: true });
      this._model.setProperty("/messages", messages);
      this._model.setProperty("/draft", "");
      this._model.setProperty("/busy", true);
      this._scrollToEnd();

      const idx = messages.length - 1;
      try {
        const res = await this._post({ message: text, history: history });
        const isJson = (res.headers.get("content-type") || "").indexOf("json") >= 0;
        const body = isJson ? await res.json().catch(function () { return null; }) : null;

        if (!res.ok || !body) {
          // Translate the usual BTP problems into something a user can act on.
          if (res.status === 401 || (res.ok && !body)) { throw new Error(i18n.getText("sessionExpired")); }
          if (res.status === 403) { throw new Error(i18n.getText("notAuthorized")); }
          if (res.status === 404) { throw new Error(i18n.getText("routeNotFound")); }
          throw new Error((body && body.error && body.error.message) || ("HTTP " + res.status));
        }
        const reply = body.reply || "(no answer)";
        messages[idx] = {
          role: "assistant",
          text: reply,
          html: toHtml(reply),
          calls: (body.trace || []).map(formatCall).join("\n\n")
        };
      } catch (e) {
        const msg = i18n.getText("errorPrefix") + " " + e.message;
        messages[idx] = { role: "assistant", text: msg, html: toHtml(msg), skip: true };
      } finally {
        this._model.setProperty("/messages", messages);
        this._model.setProperty("/busy", false);
        this._scrollToEnd();
        this.byId("input").focus();
      }
    },

    _scrollToEnd: function () {
      setTimeout(() => this.byId("scroll").scrollTo(0, 999999, 250), 100);
    }
  });
});
