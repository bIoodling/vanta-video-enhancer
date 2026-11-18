# Compatibility and limitations

The extension leaves the original media element, URL, playback clock and audio in place. A pointer-transparent sibling canvas displays enhanced pixels over compatible players. This avoids replacing the player or reconstructing streams. It cannot guarantee every site's compositor or layout will cooperate.

| Situation | Behaviour |
|---|---|
| Same-origin or CORS-approved HTML5 SDR media | GPU processing where the browser permits frame upload |
| Cross-origin iframe | Content script runs independently in a permitted frame; background chooses one winning frame per tab |
| Cross-origin media without CORS approval | Original playback continues; unsupported status after security rejection |
| DRM / EME media | Original presentation; protected media is not processed |
| Native Picture-in-Picture | Original presentation; no processed PiP output |
| Native fullscreen on the video itself | Original presentation; a sibling canvas cannot enter the native video surface |
| Fullscreen on a player container | Sibling canvas remains a descendant; site-specific compositing still needs validation |
| Native text tracks enabled | Original presentation to preserve captions |
| Site DOM captions and controls | Remain in place; fixture checks sibling stacking and pointer pass-through |
| Native video controls | Original surface is revealed while hovered or keyboard-focused so controls remain visible |
| Object-fit cover / contain | Aspect-preserving reconstruction with crop clipping and percentage object-position |
| Rotated video / transformed container | Unsupported; original presentation restored |
| Closed shadow DOM, canvas-only players, browser-internal players | Cannot discover an accessible HTMLVideoElement; no processing |
| HDR / wide-gamut video | SDR canvas pipeline only; colour fidelity is not certified |
| Device loss | Original is revealed, resources disposed, one automatic retry for the current player |
| Hidden document or offscreen video | No new GPU frames submitted; processing resumes when visible |

Detection uses main- and child-frame viewport visibility, element styling and recent interaction. It cannot perfectly identify ads, distinguish every occluded player, infer a child's visibility through an inaccessible cross-origin ancestor, or measure actual audio amplitude. Muted/volume properties are signals, not an audio analyser. Polling complements DOM observation for open shadow roots and SPA updates.

Fixed sibling compositing is conservative but can fail with transformed/filtered ancestors, unusual stacking contexts, sticky clipping, object-position adjustments, overlays and custom fullscreen players. These need site-specific manual checks. The extension does not attempt browser security bypasses to extend compatibility.

YouTube, Shorts, TikTok, anime and movie services are **not certified**. Streaming sites may use CORS restrictions, DRM, canvas-only rendering, consent screens, ad players or account-specific layouts. A clean local test pass cannot establish compatibility with those services.

Audio synchronization has not been measured with an audiovisual synchronization test. Audio playback and the source clock are untouched, but the processed canvas can lag by a frame or more under load. No claim of perceptually lossless processing, native 4K reconstruction or stable 4K Ultra performance on arbitrary hardware is made.

