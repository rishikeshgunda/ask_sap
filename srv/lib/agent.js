// The "brain loop": the LLM decides which MCP tool to call, CAP runs it, repeat until the LLM answers.
import { getMcp } from './mcp-client.js'
import { groqChat } from './groq.js'

const MAX_STEPS = 5
const MAX_TOOL_CHARS = 3500   // Groq's free tier allows few tokens per minute, so keep tool results small
const MAX_HISTORY = 4

const SYSTEM = `You are Ask SAP, a read-only assistant for SAP S/4HANA purchase orders.
Never invent data: use only tool results.
- Service API_PURCHASEORDER_PROCESS_SRV, entity sets A_PurchaseOrder and A_PurchaseOrderItem.
- A_PurchaseOrder fields: PurchaseOrder, CompanyCode, Supplier, CreationDate, PurchaseOrderType, PurchasingGroup, PurchasingOrganization, DocumentCurrency.
- A_PurchaseOrderItem fields: PurchaseOrder, PurchaseOrderItem, PurchaseOrderItemText, Plant, Material, OrderQuantity, NetPriceAmount.
- Need other fields? Call get_metadata with service and entity first.
- Always pass select (only needed fields). Use top 10 unless asked for more (max 50).
- Filters are OData V2 with quoted strings: CompanyCode eq '2120'. Dates: CreationDate ge datetime'2012-01-01T00:00:00'.
- On error or no rows, say so. You cannot change SAP data.
- Plain text only, no markdown tables or bold. Lists use "- ". Keep answers short.`

/** Convert MCP tool definitions to the OpenAI/Groq "tools" format. */
const toGroqTools = (tools) => tools.map((t) => {
  const { $schema, ...parameters } = t.inputSchema || { type: 'object', properties: {} }
  return { type: 'function', function: { name: t.name, description: t.description, parameters } }
})

/** Small models sometimes send numbers as strings ("5"). Fix that using the tool's own schema. */
function coerceArgs(tool, args) {
  const props = tool?.inputSchema?.properties || {}
  for (const [k, v] of Object.entries(args)) {
    const type = props[k]?.type
    if ((type === 'integer' || type === 'number') && typeof v === 'string' && v.trim() !== '' && !isNaN(v)) args[k] = Number(v)
  }
  return args
}

const toolText = (result) =>
  (result.content || []).map((c) => c.text ?? '').join('\n').slice(0, MAX_TOOL_CHARS)

export async function runAgent(message, history = []) {
  const { client, tools } = await getMcp()
  const groqTools = toGroqTools(tools)
  const trace = []

  const messages = [
    { role: 'system', content: SYSTEM },
    ...history
      .filter((h) => (h.role === 'user' || h.role === 'assistant') && h.content)
      .slice(-MAX_HISTORY)
      .map((h) => ({ role: h.role, content: String(h.content).slice(0, 800) })),
    { role: 'user', content: message }
  ]

  for (let step = 0; step < MAX_STEPS; step++) {
    let resp
    try {
      resp = await groqChat({ messages, tools: groqTools })
    } catch (e) {
      // Models occasionally produce a malformed tool call; one retry usually fixes it.
      if (e.status === 400 && /tool_use_failed/.test(e.body || '')) resp = await groqChat({ messages, tools: groqTools })
      else throw e
    }
    const msg = resp.choices?.[0]?.message
    if (!msg) throw new Error('Groq returned an empty answer.')

    if (!msg.tool_calls?.length) return { reply: (msg.content || '').trim(), trace }

    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls })

    for (const call of msg.tool_calls) {
      const name = call.function.name
      let text
      try {
        const tool = tools.find((t) => t.name === name)
        if (!tool) throw new Error(`Unknown tool ${name}`)
        const args = coerceArgs(tool, JSON.parse(call.function.arguments || '{}'))
        trace.push({ tool: name, args: JSON.stringify(args) })
        text = toolText(await client.callTool({ name, arguments: args }))
      } catch (e) {
        text = `Tool error: ${e.message}`
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: text })
    }
  }
  return { reply: 'I could not finish this question within the allowed number of steps. Please try a simpler question.', trace }
}
