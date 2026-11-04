import asyncio, json, os, sys
from pathlib import Path
from datetime import timedelta
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def main():
    args=sys.argv[1:]
    if args[0]=='code':
        name='execute_blender_code';params={'code':Path(args[1]).read_text()}
    else:
        name=args[0];params=json.loads(args[1]) if len(args)>1 else {}
    server='/Users/you/.local/share/blender-official/v1.0.3/venv/bin/blender-mcp'
    env={**os.environ,'BLENDER_MCP_HOST':'127.0.0.1','BLENDER_MCP_PORT':'9877','BLENDER_PATH':'/Applications/Blender.app/Contents/MacOS/Blender'}
    async with stdio_client(StdioServerParameters(command=server,env=env)) as (r,w):
        async with ClientSession(r,w) as session:
            init=await session.initialize()
            response=await session.call_tool(name,params,read_timeout_seconds=timedelta(seconds=180))
            data=response.structuredContent
            if data is None:
                data=json.loads(next(c.text for c in response.content if c.type=='text'))
            print(json.dumps(data,ensure_ascii=False,indent=2))
            if response.isError or data.get('status') in ('error','failed') or (isinstance(data.get('result'),dict) and data['result'].get('status')=='error'):
                raise SystemExit(1)
asyncio.run(main())
