import asyncio
import json
import sys
import os
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def main():
    params = StdioServerParameters(command='uvx', args=['blender-mcp'], env={**os.environ, 'BLENDER_MCP_DISABLE_TELEMETRY': '1'})
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            if len(sys.argv) == 1:
                result = await session.list_tools()
                print(json.dumps([{'name': t.name, 'schema': t.inputSchema} for t in result.tools], indent=2))
            else:
                code = Path(sys.argv[1]).read_text()
                result = await session.call_tool('execute_blender_code', {'code': code}, read_timeout_seconds=__import__('datetime').timedelta(seconds=1800))
                print(result.model_dump_json(indent=2))

asyncio.run(main())
