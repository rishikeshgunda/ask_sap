// Custom CAP bootstrap (local development only).
//
// The UI calls the backend with a RELATIVE url (odata/v4/chat/...), because on BTP the page lives
// under an app-specific path and the managed approuter maps "odata/..." to the CAP service.
// Locally CAP serves the UI under /asksap/webapp/, so we map that path back to the service here.
import cds from '@sap/cds'

if (process.env.NODE_ENV !== 'production') {
  cds.on('bootstrap', (app) => {
    app.use((req, _res, next) => {
      const prefix = '/asksap/webapp'
      if (req.url.startsWith(prefix + '/odata/')) req.url = req.url.slice(prefix.length)
      next()
    })
  })
}
