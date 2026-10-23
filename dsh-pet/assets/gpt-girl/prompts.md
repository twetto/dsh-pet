# Generation provenance and prompts

## Yaw head poses v1

Built-in `image_gen` edits of `concept-v1.png`, with transparent backgrounds.
Saved as `idle-look-left-v1.png` and `idle-look-right-v1.png`.

Left prompt (verbatim):

Use case: precise-object-edit. Create a distinct left-looking idle head pose of this exact approved white dragon chibi desktop mascot. Turn ONLY her HEAD and GAZE toward the LEFT EDGE OF THE IMAGE (viewer left), about 20 degrees from its neutral orientation, clearly readable as looking sideways rather than merely tilting. Both lavender eyes remain visible, irises noticeably aimed left; tiny curious closed-mouth smile. Keep head upright rather than cocked. White horns, pointed ears, hairclip, bangs and front hair follow the modest head turn naturally. Preserve identity, soft rounded proportions, line style, white/lavender palette and moderate detail. Keep the entire torso, dress, arms, hands, wings, lower hair, tail, legs and feet in EXACTLY the same front-facing pose, position and scale as the supplied reference. Do not move the body, lean it, gesture, add objects, change expression dramatically or redesign anything. Preserve the exact 1312x1199 canvas and whole-character framing, generous original transparent margins, feet baseline and head size/neck location; no zoom or crop. SINGLE full-body sprite on genuinely transparent alpha background. No labels, no arrows, no text, no other figures, no background or ground shadow. This is a head-turn pose for blending with the original; keep registration as close as possible.

Right prompt (verbatim):

Use case: precise-object-edit. Create a distinct right-looking idle head pose of this exact approved white dragon chibi desktop mascot. Turn ONLY her HEAD and GAZE toward the RIGHT EDGE OF THE IMAGE (viewer right), about 20 degrees from its neutral orientation, clearly readable as looking sideways rather than merely tilting. Both lavender eyes remain visible, irises noticeably aimed right; tiny curious closed-mouth smile. Keep head upright rather than cocked. White horns, pointed ears, hairclip, bangs and front hair follow the modest head turn naturally. Preserve identity, soft rounded proportions, line style, white/lavender palette and moderate detail. Keep the entire torso, dress, arms, hands, wings, lower hair, tail, legs and feet in EXACTLY the same front-facing pose, position and scale as the supplied reference. Do not move the body, lean it, gesture, add objects, change expression dramatically or redesign anything. Preserve the exact 1312x1199 canvas and whole-character framing, generous original transparent margins, feet baseline and head size/neck location; no zoom or crop. SINGLE full-body sprite on genuinely transparent alpha background. No labels, no arrows, no text, no other figures, no background or ground shadow. This is a head-turn pose for blending with the original; keep registration as close as possible.

## Half-blink v1

Built-in `image_gen` edit of `concept-v1.png`, with transparency enabled. The
result is saved as `idle-half-blink-v1.png`. Only eye regions are sampled at
runtime; the full-body variant is never swapped into the displayed silhouette.

Final prompt (verbatim):

Use case: precise-object-edit. Asset: half-closed-eye intermediate blink pose for the supplied white dragon chibi desktop mascot. Edit ONLY the two eyes: make both eyelids halfway lowered in a natural mid-blink, upper lids covering the upper half of each iris, lower half of lavender irises still visible. This is a neutral fast mid-blink, not sleepy, angry or smiling. Preserve the original tiny smile and eyebrows. Keep absolutely everything outside the eyes as close to unchanged as possible: same canvas dimensions, original face/head angle and position, exact hair/horns/ear/hairclip/dress/wings/tail/feet placement, contour, linework, coloring, shading, ornamentation, transparency. Do not reframe, scale, shift, crop or simplify. Single same full-body character on genuinely transparent alpha background. No extra objects, text, motion lines or symbols. The open-eye original is the identity and registration reference. Preserve the 1312x1199 canvas.

Mode: built-in `image_gen`; `transparent_background: true` for both outputs.

## Approved concept v1

Inputs: previous ornate and minimal generated concepts as references. Their identity
was derived from user references `3f03ee1ac0d747ad.png` (turnaround) and
`41ea1121953ffb33.png` (face), with the existing pet logo as a chibi-style reference
only. The user approved the intermediate version, not the two earlier versions.

Final prompt (verbatim):

Refine the white-haired dragon girl desktop mascot to an INTERMEDIATE level of visual detail between the two preceding concepts. The user finds the first too ornate and the second too simple. Use the latest simpler version as the base for round chubby proportions, compact silhouette and pose, but restore selected detail from the earlier elaborate version. Aim for the visual richness of a hand-drawn chibi desktop-pet character: moderate local edge detail, not an ornate full illustration and not a flat minimal icon. Single full-body standing idle character. Keep large rounded head, soft cheeks, tiny plump body, lavender eyes, white hair with lavender shadows, two white segmented horns, pointed ears, curled ahoge, white knot hairclip, small dragon wings, thick curled scaled tail. Slightly reduce the oversized head from the latest version so the torso/dress has a little more room, about 2.3 heads tall. Restore restrained costume personality: small high Mandarin-style collar with a silver knot clasp, a subtle diagonal decorative seam, one small knot ornament at each side of the waist, two short simple tassels, a few elegant silver-lavender hem motifs, one secondary flowing skirt layer and gentle sleeve folds. Keep the costume opaque and modest, no cleavage or thigh slit, no realistic bust emphasis. Hair should have layered chunky locks with a modest number of fine interior strands, more textured than the latest version but far less intricate than the earliest. Tail should show a few rows of simplified overlapping scales rather than entirely smooth broad sections. Wings medium-small with readable lavender membranes and 2–3 fine ribs. Clean dark muted-lavender ink contours, variable line weight, soft restrained cel shading with a few gentle painted highlights, NOT perfectly flat vector-like art. Preserve friendly calm tiny smile and relaxed stubby arms. Keep details clustered around hairclip, collar, waist and tail so large quiet white areas remain and design is legible at 200px. No flowers, books, jewels, extra props or excessive chains. Neither extreme: not the busy ornate first design, not the extremely stripped-down second. Fully visible centered character with ample transparent margin around horns, wings, tail and feet. Actual transparent alpha background, no shadow plane, no checkerboard, no lettering, no labels, no other figures. Output one refined character, not a comparison sheet.

## Blink v1

Edit target: `concept-v1.png`, preserve pose/canvas, change eyes only.
Generated with the built-in image tool; no programmatic image editing applied.

Final prompt (verbatim):

Use case: precise-object-edit. Asset type: closed-eye blink pose for a two-pose desktop mascot idle animation. Edit ONLY the two eyes in the supplied approved white dragon chibi image: close both eyes into relaxed thin curved eyelids with the same dark lavender lash line. Keep her tiny gentle smile unchanged. Every other pixel/element should remain as close as possible to the input: identical whole-body standing pose, head angle, exact face placement and shape, white hair locks, ahoge, horns, ears, hair ornament, earrings, wings, hands, white/lavender dress details, feet, tail, color palette, lighting, line weight, shading, alpha silhouette. Do NOT redraw, simplify, add details, shift, rotate, scale, crop or reframe the character. Preserve the original image canvas dimensions and exact registration of feet and face. No sleeping symbols, no motion lines, no extra expression, no eyebrow changes, no blush changes, no new objects, no text. The eyes alone change from open to naturally closed for a brief blink. Preserve genuinely transparent alpha background, no background color, no checkerboard, no shadow plane.
