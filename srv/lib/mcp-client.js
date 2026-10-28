// CAP acts as the MCP *client*: it starts srv/mcp/server.mjs as a child process
// and talks to it over stdio (stdin/stdout).
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { loadConfig } from './config.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverFile = path.resolve(here, '../mcp/server.mjs')

let connecting = null

async function connect() {
  loadConfig()
  const transport = new StdioClientTransport({
    command: process.execPath,        // the same node that runs CAP
    args: [serverFile],
    env: Object.fromEntries(Object.entries(process.env).filter(([, v]) => typeof v === 'string')),
    stderr: 'inherit'                 // MCP server logs appear in the CAP terminal
  })
  const client = new Client({ name: 'ask-sap-cap', version: '0.1.0' })
  client.onclose = () => { connecting = null }   // reconnect on next question if the child dies
  try {
    await client.connect(transport)
  } catch (e) {
    // The real reason (missing file, bad config...) is printed by the child process to the log (stderr: 'inherit').
    throw new Error('The MCP server could not start. Look at the CAP log (cf logs ask-sap-poc-srv --recent) for the reason. [' + e.message + ']')
  }
  const { tools } = await client.listTools()
  return { client, tools, instructions: client.getInstructions() || '' }
}

/** Returns { client, tools, instructions }; starts the MCP server on first use. */
export function getMcp() {
  if (!connecting) connecting = connect().catch((e) => { connecting = null; throw e })
  return connecting
}
