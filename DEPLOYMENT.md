# Ask SAP POC: deployment to SAP BTP Cloud Foundry (HTML5 repository + SAP Build Work Zone)

```
Work Zone / HTML5 Apps  ->  managed approuter  ->  destination srv-api (forwards the user token)
        ->  CAP service (XSUAA role AskSapUser)  ->  MCP server (child process)
        ->  iFlow ZMCP_Gateway on Integration Suite  ->  S/4 OData
```

What is deployed (mta.yaml):

| Module / resource | What it is |
|---|---|
| ask-sap-poc-srv | CAP service. Starts the MCP server (srv/mcp/server.mjs) as a child process |
| asksappocasksap | UI5 app, built to dist/asksap.zip (contains xs-app.json) |
| ask-sap-poc-app-deployer | Uploads the zip to the HTML5 Application Repository and creates destination srv-api |
| ask-sap-poc-destinations | Destinations that let Work Zone find the app and the XSUAA instance |
| ask-sap-poc-auth (xsuaa) | Scope AskSapUser, role template AskSapUser, role collection AskSap_User |
| ask-sap-poc-destination, ask-sap-poc-html5-repo-host | Destination service and HTML5 repo (app-host) |
| ask-sap-config | YOUR user-provided service with the iFlow and Groq credentials (step 3) |

## 0. Prerequisites (once)

- A Cloud Foundry space in your subaccount (BAS: use the Cloud Foundry login of the dev space).
- Entitlements/subscriptions in the subaccount: Authorization and Trust Management (plan application),
  Destination (lite), HTML5 Application Repository (app-host and app-runtime), SAP Build Work Zone, standard edition (subscription).
- Tools: Cloud Foundry CLI v8 with the multiapps plugin (`cf install-plugin multiapps`), MTA Build Tool (`npm i -g mbt`),
  `@sap/cds-dk` installed globally (BAS has it). Do NOT add @sap/cds-dk to this project's dependencies.
- The iFlow ZMCP_Gateway deployed and started, as before. Nothing in the iFlow changes.

## 1. Log in

```
cf login -a https://api.cf.us10-001.hana.ondemand.com     # use the API endpoint of your subaccount
cf target                                                   # check org and space
```

## 2. Install dependencies (once)

```
npm install
```

## 3. Create the configuration service (before the first deploy)

```
cp deployment/config.example.json deployment/config.json
# edit deployment/config.json: replace every <placeholder>, keep it valid JSON
cf create-user-provided-service ask-sap-config -p deployment/config.json -t ask-sap-config
rm deployment/config.json
```

Values: the service key of your Process Integration Runtime instance (oauth.clientid, clientsecret, tokenurl, url) and your Groq key.
To change a value later:
```
cf update-user-provided-service ask-sap-config -p deployment/config.json
cf restage ask-sap-poc-srv
```

## 4. Build and deploy

```
npm run build:mta        # mbt build -t ./mta_archives
npm run deploy           # cf deploy mta_archives/ask-sap-poc_1.0.0.mtar
```

## 5. Give yourself access (required, otherwise 403)

BTP cockpit -> Security -> Users -> your user -> Assign Role Collection -> **AskSap_User**.
Then sign out of the browser session and sign in again, so the new token contains the scope.

## 6. First test without Work Zone

BTP cockpit -> HTML5 Applications -> Ask SAP -> open. Ask: "Show 5 purchase orders for company code 2120".

## 7. Add the app to SAP Build Work Zone

(Menu names can differ slightly between Work Zone releases.)
1. Work Zone -> Channel Manager -> content provider **HTML5 Apps** -> refresh/update content.
2. Content Manager -> Content Explorer -> HTML5 Apps -> **Ask SAP** -> Add to My Content.
3. Content Manager -> My Content -> New -> **Group** "Ask SAP" containing the app.
4. Add the app and the group to a **Role** (for a first test the default role "Everyone").
5. Site Directory -> your site -> open the site URL. The tile "Ask SAP" appears.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| 403 in the chat, message about authorization | Role collection not assigned, or token from before the assignment | Step 5, then sign out and in |
| 403 on every POST, even with the role | CSRF token missing | The UI fetches it automatically. Check xs-app.json still has `csrfProtection: true` AND the UI is the deployed version (hard refresh) |
| 404 on /odata/v4/chat/ask | Route or destination missing, or the UI calls an absolute path | Check `cf env ask-sap-poc-srv`, destination `srv-api` in cockpit (Connectivity -> Destinations), and that the app zip contains xs-app.json |
| 401 / login page instead of JSON | Session expired | Reload the page |
| 502 in the chat, "Groq ..." | Groq key, model or rate limit | `cf update-user-provided-service`, then `cf restage ask-sap-poc-srv` |
| 502 "Token request failed: 401" | Wrong CLIENT_ID, CLIENT_SECRET or TOKEN_URL | Fix ask-sap-config, restage |
| 502 "Gateway 403 not_allowed" | iFlow allow-list | Edit the ALLOWED map in the iFlow script and in srv/mcp/server.mjs |
| `cf deploy` fails: service ask-sap-config not found | Step 3 skipped | Run step 3, deploy again |
| Logs | | `cf logs ask-sap-poc-srv --recent` |

## Local development (unchanged idea)

```
cp .env.example .env     # fill in iFlow values and the Groq key
npm start                # or npm run dev
# open http://localhost:4004/asksap/webapp/index.html  (in BAS: the exposed port 4004 URL)
```
Locally there is no login (auth kind dummy). `npm run inspect` tests the MCP server alone.
