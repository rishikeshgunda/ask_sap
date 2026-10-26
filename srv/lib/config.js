// One place that loads configuration:
//  - locally: the .env file in the project root
//  - on BTP:  the user-provided Cloud Foundry service "ask-sap-config" (bound to the CAP service)
// Variables that are already set are never overwritten.
const SERVICE_NAME = 'ask-sap-config'
let loaded = false

export function loadConfig() {
  if (loaded) return
  loaded = true
  try { process.loadEnvFile() } catch { /* no .env file (normal on BTP) */ }
  try {
    const vcap = JSON.parse(process.env.VCAP_SERVICES || '{}')
    for (const inst of vcap['user-provided'] || []) {
      const ids = [inst.name, inst.instance_name, inst.binding_name, ...(inst.tags || [])]
      if (!ids.includes(SERVICE_NAME)) continue
      for (const [k, v] of Object.entries(inst.credentials || {})) {
        if (process.env[k] === undefined && v !== null && v !== '') process.env[k] = String(v)
      }
    }
  } catch { /* VCAP_SERVICES is not valid JSON: ignore */ }
}
