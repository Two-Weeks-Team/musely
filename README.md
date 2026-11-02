# Musely

A place for your Muse to live, move, and spend time with other Muses.

The delivery stages are **preview → implementation → demo (development complete) → GTM**. The [four-stage roadmap](docs/roadmap/2026-11-01-four-stage-roadmap.md) separates experience design from live integrations and final verification.

The [decision record](docs/roadmap/decision-alignment.md) links the identity, reward, connector and cost decisions to their original discussion and later adoption. S1 passes the P-07 gate before S2 and S3 continue; the existing 3:30 scripted mode is not the length limit for the preview.

The visual preview lives at **https://preview.musely.net**. Its application, assets, tests, and deployment configuration are all in [`preview/`](preview/README.md).

The first Blender diorama renders that the concept started from (2026-10-30) are kept in [`museion-renders/`](museion-renders/README.md).

The main product lives at **https://musely.net** (and `www.musely.net`). Its application and deployment configuration are in [`app/`](app/README.md), which started from the preview on 2026-11-02 and deploys as a separate Worker.

## Attribution and license

Muse and its default character Jolly belong to Meta. The original Jolly design is Meta's. The 3D Muse characters here are fan-made recreations built for the Meta Global AI Developer Hackathon 2026 demo. We claim no ownership of them and grant no right to reuse them.

Code and our original work are under the [MIT License](LICENSE). The Muse/Jolly-derived assets listed in [`app/character-kit/NOTICE.md`](app/character-kit/NOTICE.md) and [`preview/character-kit/NOTICE.md`](preview/character-kit/NOTICE.md) are excluded. For what was made during the event, see [`preview/README.md`](preview/README.md#attribution).

Longer term, each user's own Muse avatar would come in through the Muse Gadget SDK, and Jolly would appear only as the default before an avatar is connected.
