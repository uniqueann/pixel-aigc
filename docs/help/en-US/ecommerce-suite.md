# E-commerce Suite Guide

E-commerce Suite is an all-in-one listing image generation and layout workspace for marketplaces. Upload one clean product photo, confirm product specs, and generate a complete 7-slot set (pure-white main image, lifestyle scenes, detail close-ups, feature highlights, and dimension callouts) with free layer editing and compliance-checked ZIP export.

## End-to-End Workflow

```
Upload Product Photo → Specs & Selling Points → Single / Batch Generation → Text & Layer Editing → Compliance Precheck & Export
```

1. **Create a Suite Project**: Upload high-resolution product images, enter a product title, target platform, and category, then configure specs and selling points.
2. **Work in the Suite Workspace**: Switch across all 7 slots, track generation progress, and drag text or dimension overlays directly on the canvas.
3. **Generate Slots**: Regenerate individual slots or launch full-set batch generation asynchronously on the server without staying on the page.
4. **Edit Copy & Refine**: Add text badges, link confirmed dimension specs, or send any slot image to Image Studio for retouching and write-back as a new version.
5. **Precheck & Export**: Run platform compliance checks and download individual high-res images or a full ZIP bundle.

## Step 1: Create Project & Product Specs

Open **E-commerce Suite** from the sidebar and click **New Suite**:

1. **Upload Product Photos**:
   - **Main Product Photo (Required)**: Upload a high-resolution studio or white-background product image (up to 20 MB per file).
   - **Additional Reference Images (Optional)**: Add alternate angles, close-ups, or scene references for stronger consistency.
2. **Product Info & Target Platform**: Enter title, optional SKU, target marketplace (such as Amazon US), and product category (Home & Furniture / Kitchen & Dining / Storage & Textiles).
3. **Specs & Selling Points**: Fill category-suggested specifications (dimensions, materials, key features) and custom tags; check items you want available for layout overlays.
4. **Select Slots & Visual Style**: Standard 7 slots are enabled by default (toggle slots on/off as needed). Pick a unified scene tone and click **Create & Open Workspace**.

## Step 2: Workspace & Slot Management

The workspace includes the canvas stage on the left, the 7-slot strip at the bottom, and the settings drawer on the right:

- **Slot Status Dots**: Each slot thumbnail displays status (Green: ready / Yellow: generating / Red: failed / Gray: empty). Click any slot to switch focus.
- **Interactive Canvas Layers**: Preview generated artwork and select/drag text boxes or dimension callouts directly on the canvas.
- **Image Studio Bridge**: Click **Refine in Studio** above the canvas to send the slot image to Image Studio for Inpaint, Erase, Smart Edit, Relight, or Retouch, then write back as a new version.

## Step 3: Single-Slot & Batch Generation

- **Single Slot**: Under **Generate** in the right panel, choose model, resolution, and candidate count, then click generate. Credits settle only for successful images.
- **Batch Generate All**: Click **Batch Generate** in the top bar, choose target slots and resolution (1K / 2K / 4K), confirm estimated credits, and submit. The server queue continues even if you close the page.

## Step 4: Typography Layers & Version History

- **Layers**: Under **Layers**, add headlines, selling points, or spec callouts linked directly to confirmed product facts. Vector overlays stay independent from the base image and auto-save locally.
- **Versions**: **Versions** tracks original inputs, AI outputs, and Image Studio write-backs. Switch active versions anytime without losing edits, or bake layers into a flattened version snapshot.

## Step 5: Compliance Precheck & Export

Click **Precheck & Export** at the bottom-right to open the export drawer:

1. **Platform Compliance Precheck**: Automatically validates dimensions, format, white-background compliance, and marketplace rules (such as Amazon main image no-overlay locks), flagging visual checks that need quick human confirmation.
2. **Auto-Save Unsaved Layers**: Unbaked layer edits are automatically snapshotted before final compositing so exports match your live canvas preview.
3. **Inspect Results**: Review passed, warning, and blocking items with clear remediation tips.
4. **One-Click Download**: Export individual assets or download all ready images as a ZIP archive.

## Credits & Recovery

- **Transparent Pricing**: Single and batch slots reserve credits by model, resolution, and count, settling only successful outputs and automatically refunding failures/timeouts.
- **Live Balance Refresh**: When generations finish, your header balance refreshes automatically.
- **Zero-Cost Editing & Export**: Layer editing, version switching, local backups, compliance prechecks, and ZIP exports cost zero credits.
- **Backup & Recovery**: Click **Import Recovery Package** on the suite list page or open the **Backup & Restore** menu in the workspace header to save or restore projects with embedded images (ZIP).
