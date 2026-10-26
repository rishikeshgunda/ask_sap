import cds from '@sap/cds'
import { runAgent } from './lib/agent.js'

export default class ChatService extends cds.ApplicationService {
  init() {
    this.on('ask', async (req) => {
      const { message, history } = req.data
      if (!message || !message.trim()) return req.reject(400, 'Please type a question.')
      try {
        return await runAgent(message.trim(), history || [])
      } catch (e) {
        cds.log('chat').error(e)
        return req.reject(502, e.message || 'The assistant failed.')
      }
    })
    return super.init()
  }
}
