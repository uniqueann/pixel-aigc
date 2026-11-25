# Image Studio Overview

Image Studio brings together 8 focused AI editing tools. On desktop, the image canvas sits on the left, tool parameters on the right, and credit cost + submit controls at the bottom; mobile screens stack them vertically. Every tool displays exact credit cost before submission.

## 8 Tools at a Glance

| Tool | What It Does |
|------|--------------|
| Smart Edit | Edit images via natural language: swap backgrounds, change materials/colors, or add elements |
| Relight | Pick primary light direction on a compass and tune softness and color temperature; supports front & rim light |
| Erase | Paint over bystanders, watermarks, or blemishes to remove them seamlessly |
| Inpaint | Paint a mask and describe what to fill; runs on Wanx 2.1 Edit (1 output matching original dimensions) |
| Variations | Generate alternate versions of a product shot — great for A/B creative testing |
| Fusion | Keep the product intact while blending it into a second reference scene image |
| Outpaint | Expand canvas borders outward and seamlessly extend the background |
| Retouch | Multi-select touch-ups: blemish cleanup, brightening, edge sharpening, and texture consistency |

## Standard Workflow

1. Choose a tool and upload an image (generate stays disabled until inputs are valid).
2. Tune parameters on the right (output count, resolution, lighting, directions, etc.). Inpaint always outputs 1 image matching the source size.
3. Review the credit quote on the action button and click to generate.
4. Save satisfied outputs to **My Assets**.

### Image File Size

Each image is limited to **20 MB**. Size and format are checked immediately upon selection so oversized files fail fast before uploading.

## Using Erase

1. Upload an image and paint over unwanted objects with the brush — or click the product with **Smart Selection** to mask it cleanly.
2. Prompt description is optional: leave blank for small objects, or describe the replacement surface (e.g. "clean wooden table") rather than writing "delete xxx".
3. Only painted regions change; unmasked pixels remain intact.

## Reading Visual Examples

Before uploading, each tool shows a 3-step visual diagram sharing one consistent legend:

- **Red highlight**: Painted mask matching the canvas brush and Smart Selection highlight.
- **Dashed box**: Area modified by AI (filled background in Erase, generated patch in Inpaint, scene-only input in Fusion, or green target canvas in Outpaint).
- **Solid box**: Preserved region kept faithful to the original pixels (product fidelity in Fusion, original pixel frame in Outpaint).
- **Callout bubble**: Mask-scoped prompt applied specifically to the painted region in Inpaint.

## Using Inpaint

1. Upload an image and paint the target region within the image bounds.
2. Enter the required inpaint description specifying what should appear in the masked area.
3. After generation, source, mask, and prompt stay ready for quick iteration; adopting a result as a new source clears the old mask first.

Replacing the source image prompts before clearing your existing mask.

## Using Outpaint

1. Upload an image — the green dashed box shows your target canvas bounds.
2. Drag corners/edges outward or edit target width/height directly; original pixels inside the frame stay untouched.
3. Choose an output target mode: **Free Expand** (exact pixel padding), **Platform Ratio** (match ratio at original resolution), or **Platform Size** (scale & pad to exact marketplace pixels).

## Using Fusion

1. Upload the product photo you want to keep in slot 1, and upload the background/scene reference in slot 2.
2. Product shape, colors, surface texture, printed copy, and logos stay faithful.
3. Scene image contributes lighting and environment only without inserting stray items onto the product.
4. Optional notes steer scene or mood; fidelity constraints always take precedence over conflicting notes.
5. Click **Use Last Scene** when the scene slot is empty to reuse your previous scene reference.
6. Click either thumbnail to zoom in or download the original photo.

## Prompt Writing Tips

- **Erase**: Leave blank for small items or describe what should replace them ("clean white studio backdrop") rather than writing "remove object".
- **Smart Edit / Inpaint**: Describe the target state rather than the verb ("red leather bag" beats "change color of bag"). Inpaint description is required.
- **Retouch Directions** (Remove blemishes / Brighten / Sharpen edges / Unify texture) support **multi-select**.

## Reading the Relight Compass

- **Compass**: The product sits at the center. Solid arrows point from primary light toward the product; dashed indicators show cast shadow direction. **Front Light / Backlight** toggles below cover camera-axis and rim lighting.
- **Front vs. Backlight**: Front light uses a camera badge (shadows fall behind product) while backlight shows a halo/rim glow toward the lens so direction icons never conflict.
- **Light Quality**: **Soft** gives smooth studio transitions; **Hard** yields crisper contrast and sharper shadow edges.
- **Color Temperature**: **Warm / Neutral / Cool** adjusts ambient illumination and highlights without distorting true product color.
- **Presets**: Start fast with **Studio Soft**, **Sunset Warm**, or **Cool Rim** presets and fine-tune from there.

## Billing & Rate Limits

- Smart Edit, Variations, Relight, Retouch, and Fusion bill by model and output resolution; Erase, Inpaint, and Outpaint have fixed per-run or pass pricing shown upfront.
- Credits are reserved, settled only for successful outputs, and auto-refunded on failure.
- Erase / Inpaint / Outpaint allow up to 20 runs/hour and 2 concurrent tasks per user.

## Smart Selection

Inside Erase and Inpaint, click **Smart Selection** and click once on a product to highlight the whole item automatically — much faster than painting large masks by hand.
