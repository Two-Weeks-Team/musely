import addon_utils
import bpy

addon_utils.enable('blender_mcp', default_set=False, persistent=True)
server = getattr(bpy.types, 'blendermcp_server', None)
if server and not server.running:
    server.start()
print('MUSEION_MCP_READY', bool(server and server.running), flush=True)
