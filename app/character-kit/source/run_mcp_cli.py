"""Run a source script on a .blend through the official Blender MCP background tool.

Usage: python3 run_mcp_cli.py <blend_file> <script.py> [timeout_seconds]
The script receives __file__ so it can resolve kit paths. It must assign `result`.
"""
import asyncio, json, os, sys
from datetime import timedelta
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

SERVER = '/Users/kimsejun/.local/share/blender-official/v1.0.3/venv/bin/blender-mcp'

async def main(blend, script, timeout):
    code = f'__file__ = {str(Path(script).resolve())!r}\n' + Path(script).read_text()
    env = {**os.environ, 'BLENDER_MCP_HOST': '127.0.0.1', 'BLENDER_MCP_PORT': '9877',
           'BLENDER_PATH': '/Applications/Blender.app/Contents/MacOS/Blender'}
    async with stdio_client(StdioServerParameters(command=SERVER, env=env)) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            resp = await s.call_tool('execute_blender_code_for_cli', {'blend_file': str(Path(blend).resolve()), 'code': code},
                                     read_timeout_seconds=timedelta(seconds=timeout))
            data = resp.structuredContent
            if data is None:
                text = next((c.text for c in resp.content if c.type == 'text'), '')
                try:
                    data = json.loads(text)
                except json.JSONDecodeError:
                    print(text[-6000:])
                    raise SystemExit(1)
            print(json.dumps(data, ensure_ascii=False, indent=1))
            inner = data.get('result') if isinstance(data, dict) else None
            if resp.isError or data.get('status') in ('error', 'failed') or (isinstance(inner, dict) and inner.get('status') == 'error'):
                raise SystemExit(1)

asyncio.run(main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 900))
