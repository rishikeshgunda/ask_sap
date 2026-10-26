# Ask SAP POC

UI5 chat screen -> CAP (MCP client + Groq loop) -> MCP server (stdio) -> BTP iFlow ZMCP_Gateway -> S/4 OData (read-only)

- Deploy to Cloud Foundry (HTML5 repository + Work Zone): see **DEPLOYMENT.md**
- Local run: `cp .env.example .env`, fill it in, `npm install`, `npm start`

Layout
- app/asksap        UI5 freestyle chat app (webapp/, xs-app.json, ui5.yaml)
- srv/              CAP service (chat-service.cds/js), srv/lib (agent, groq, mcp-client, config), srv/mcp (MCP server)
- mta.yaml          deployment descriptor
- xs-security.json  XSUAA scope, role template, role collection AskSap_User
- deployment/       template for the user-provided service with the secrets
