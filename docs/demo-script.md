# Spatial Stack Executive Demo Script

Target recording length: 10 minutes.

This script is written for a hackathon judging panel and for institutional buyers: government planners, facilities managers, and housing-portfolio decision-makers. Keep the explanation plain: the app helps a planning team move from a static 2D floor plan to an inspectable spatial model without waiting for a specialist CAD or 3D-modeling handoff.

The bundled demo context is Northshore Housing Authority reviewing a Unit C1 apartment plan as part of a larger portfolio modernization program. Treat that as the demo story, not the only product boundary. Spatial Stack should be framed as a generic 2D-to-3D spatial-review workbench for teams that process many building plans.

## Core Rule

Say this clearly and repeat it when useful:

> OpenRouter interprets the 2D plan into a structured spatial contract. Python validates that contract with Pydantic, makes linked space polygons authoritative for room bounds, runs spatial sanity checks, and only then lets the browser render it for planner verification.

Do not say the browser calls OpenRouter directly. Do not say this is a full CAD, BIM, code-compliance, energy-simulation, or construction-document system. Do not say the app fabricates a fallback layout when model access is missing. The backend uses one configured OpenRouter model and fails explicitly when analysis is not trustworthy.

## Reset And Setup

Use this path for the recording:

1. Open the app.
2. Confirm the top-right service badge shows **spatial-stack-backend**.
3. From **Workspace**, use the **Sample Plans** section and click **LOAD** on `C1.jpg`.
4. If sample cards are not visible, use **Upload floor plan** and choose `backend/sample_files/C1.jpg`.
5. Watch the loading overlay show the current status message and progress bar while analysis runs.
6. Wait for the plan to become ready, then confirm the detail panel opens and the plan shows **OpenRouter** processing mode.
7. Walk through: **Workspace**, **3D**, **Top**, **Source**, **Measure**, **Furniture**, **Sun**, **Walk**, **Materials**, **Export**, **Architecture**.

Expected demo state after successful analysis:

| Area | Expected value |
|---|---|
| Sample files visible | `C1.jpg`, `floorplan.pdf` |
| Backend service | spatial-stack-backend |
| Primary demo file | `C1.jpg` |
| Demo context | Unit C1 apartment floor plan |
| Processing mode | OpenRouter |
| Result status | Ready spatial contract |
| Required viewer outputs | Interactive model, room/space labels, detected item list, source preview, top-view source overlay |
| Loading behavior | Status message and progress bar while polling the saved plan record |
| Saved state | Recent Plans list can reopen ready records and track in-flight jobs |
| Required metrics | Total area, floors, spaces or rooms, furniture fit, sightline continuity, circulation, wall length |
| Viewer modes | 3D and Top |
| Tools | Source, Measure, Furniture, Sun, Walk, Materials, Export |

Model-derived room counts, dimensions, scores, and notes can vary by run. Do not memorize exact numbers. Read the values shown in the right panel during the recording.

## Plain-English Terms

Use these explanations when the UI shows a metric or control.

- **Spatial contract**: the structured JSON result returned by the backend. It contains spaces, rooms, dimensions, coordinates, geometry, furniture placements, metrics, source file, and processing metadata.
- **Saved plan record**: the shared backend record for one analysis. Before it is ready, it carries `pending` or `processing` status plus a status message and progress percentage. After it is ready, it carries the spatial contract.
- **Recent Plans**: the shared list of saved plan records. It lets users reopen ready analyses or wait on pending and processing jobs instead of starting a new model call.
- **Processing mode**: the model path used for analysis. In this demo it should show OpenRouter.
- **Total area**: the estimated sum of floor-plan area in square metres. Treat it as model-derived and reviewable, not a surveyed legal area.
- **Detected spaces / rooms**: the spaces or rooms the analysis engine extracted from the 2D plan, including type, size, position, and confidence.
- **Furniture fit**: a planning score for whether detected or inferred furniture placements fit the extracted room geometry.
- **Sightline continuity**: a planning score for how readable the layout is from circulation and room-to-room flow.
- **Circulation**: estimated area used for movement through the space, such as halls and connecting paths.
- **Wall length**: estimated linear metres of walls in the extracted geometry.
- **3D view**: the raised SVG spatial model used to understand volume, rooms, walls, and furniture.
- **Top view**: a plan-aligned inspection mode for checking the extracted model against the original 2D layout.
- **Source overlay**: a top-view image overlay for comparing extracted geometry against the submitted plan image or sample preview.
- **Walk-through preview**: a low-angle inspection mode for understanding occupant experience. It is not a real-time game engine or final virtual-tour deliverable.
- **Original plan**: the uploaded source evidence shown in the details panel so reviewers can compare extraction against the source drawing.

## 10-Minute Recording Script

### 0:00-0:45 - Workspace Opening

Action: Start on **Workspace** with no analysis loaded.

Say:

> This is Spatial Stack. It helps institutional teams turn a static 2D floor plan into an inspectable spatial model.
>
> The demo context is Northshore Housing Authority reviewing a Unit C1 apartment plan. The broader problem is portfolio scale: planners and facilities teams may need to review hundreds or thousands of submitted layouts, but every manual 3D conversion takes specialist time.
>
> The first screen starts empty on purpose. No model loaded means the app is not pretending it already understands the building. We need source evidence first: a PNG, JPG, or PDF floor plan.

Point to the service badge.

Say:

> The service badge shows the backend is connected. That matters because the frontend is only the workbench. Model calls, validation, raw-plan handling, and storage stay behind the backend API.

### 0:45-2:00 - Load The Source Plan

Action: In **Sample Plans**, click **LOAD** on `C1.jpg`.

Say:

> I am loading the C1 sample plan. It is a residential unit plan with bedrooms, bathrooms, kitchen, living area, walk-in closets, and balcony areas. This is a realistic housing-authority use case: the source is not a CAD model in the browser. It is a static floor-plan image.
>
> The app also supports PDFs. That matters because many government and facilities workflows still receive plans as PDF submissions, not clean model files.

Wait for **Analyzing floor plan**.

Say:

> During analysis, the app is not just sitting on a blocking request. The backend has already saved a plan record, and the browser is polling that record for status updates.
>
> The status message and progress bar come from the backend worker. That is important because multimodal floor-plan analysis can take longer than a normal web request, especially when the model is generating a large structured JSON object.
>
> The backend sends the plan to OpenRouter's multimodal model path and requests structured JSON output. The output is not just a screenshot or a paragraph. It is a typed spatial contract: rooms, spaces, dimensions, coordinates, furniture placements, extracted geometry, and review metrics.
>
> The backend uses one configured OpenRouter model. The current repo default is `google/gemini-3-flash-preview`, but the important product point is that there is one configured model path, not browser-side AI and not a hidden fallback model. If a Gemini-family provider rejects the schema arguments, the backend may retry the same model with a provider-compatible JSON mode; that is not a second-model fallback. Python then validates the payload with Pydantic, treats linked space polygons as the room-boundary authority, and runs sanity checks for things like empty room extraction, missing dimensions, severe overlap, furniture outside rooms, low confidence, and incomplete geometry.
>
> If the OpenRouter key is missing or the model attempt fails, this app returns an explicit error. It does not invent a fake floor plan for demo continuity. That is important for trust: a planning tool should fail honestly when it cannot analyze the source.

If the **Recent Plans** section is visible during setup, point to it briefly.

Say:

> Recent Plans is the shared saved-state view. A completed plan can be opened again without another model call, and an in-flight plan can be selected so the user can keep waiting on the saved record.

### 2:00-3:30 - Spatial Contract And Details Panel

Action: After the result loads, point to the right-side detail panel.

Say:

> The detail panel is the review record. At the top, it shows the plan name, source file, and processing mode. For this recording, the processing mode should be OpenRouter.
>
> The first metric row gives the building type, total area, number of floors, and either detected spaces or detected rooms. These are model-derived values, so I am going to read the current values from the screen rather than treating them as fixed survey data.

Read the visible values for **TYPE**, **TOTAL AREA**, **FLOORS**, and **SPACES** or **ROOMS**.

Say:

> The scores below are planning aids. Furniture fit asks whether the extracted rooms can hold the inferred furniture. Sightline continuity gives a quick sense of whether the layout reads clearly through circulation and room connections.
>
> Below that, circulation and wall length give facilities teams fast quantities for planning discussions. These are not construction takeoff quantities. They are review metrics to decide whether the plan deserves deeper inspection.

Point to **Detected Rooms** or **Detected Spaces**, depending on the current result.

Say:

> The detected list is where a reviewer can audit the extraction. Each item has a label, type, dimensions, area, and confidence. The important thing is that the app gives the planner something inspectable, not just a polished rendering.

Open **Original Plan** if it is collapsed.

Say:

> The original plan stays attached to the analysis. That lets the reviewer compare the generated model to the submitted floor plan and catch extraction errors before the result is used in a decision.

### 3:30-5:00 - Viewer Inspection

Action: Use the main viewer in **3D** mode.

Say:

> The center of the app is the viewer. This is the product's core value: the planner can immediately inspect the extracted geometry instead of waiting for a CAD operator to rebuild the plan.
>
> In 3D mode, walls, rooms, and furniture become easier to understand as a spatial arrangement. This helps non-specialists see whether bedrooms, circulation, storage, and living areas are laid out sensibly.

Action: Click **Top**.

Say:

> Top view is the audit mode. It aligns the generated model closer to the original plan logic, so the reviewer can compare labels, room adjacency, and relative sizing against the source.
>
> The goal is not to replace professional judgment. The goal is to make judgment faster by turning a flat drawing into something measurable and interactive.

Action: Click **Source**, then toggle the overlay visible if it is available.

Say:

> The source overlay puts the submitted plan under the extracted geometry in top view. This is the fastest visual check: do the extracted spaces line up with the drawing, and do the labels and room proportions make sense?

Action: Click **Measure**, then **Enable**, and measure two visible points if practical.

Say:

> Measurement mode lets the reviewer check a distance directly in the extracted model. In a production workflow, this is where a planner would spot-check a bedroom width, hallway clearance, or balcony depth before trusting the output.
>
> If the source plan is ambiguous or the extracted dimensions look wrong, the reviewer uses that as a reason to route the plan for manual review.

### 5:00-6:20 - Furniture, Sun, And Walk-Through

Action: Click **Furniture**.

Say:

> The furniture layer shows detected or inferred placements. For facilities and housing teams, this is useful because spatial quality is not just room count. A room can be present but still be hard to use if furniture placement, door swing, or circulation is poor.

Toggle **Visible** and **Hidden** if it helps.

Say:

> Toggling furniture separates geometry review from usability review. First we check whether the rooms are extracted correctly. Then we check whether the plan works as a lived or operated space.

Action: Click **Sun** and adjust the time or compass.

Say:

> The sun and orientation controls are planning aids. They help a reviewer understand how orientation might affect daylight, shadow, and presentation. The app is not claiming to be an energy model. It is giving the planner a quick spatial read.

Action: Click **Walk**, then **Preview**.

Say:

> Walk-through preview changes the perspective from plan review to occupant experience. For a housing authority, that matters when explaining a unit layout to residents or checking whether a space feels navigable.

### 6:20-7:30 - Materials And Export

Action: Click **Materials**.

Say:

> Materials are deliberately lightweight. They are not interior-design decoration. They help a reviewer compare finish assumptions on the same extracted geometry, which can be useful for stakeholder presentation.

Action: Click **Export**.

Say:

> Export is the handoff point. The viewer can export an SVG scene for presentation, or the spatial JSON contract for downstream systems and review.
>
> The JSON is especially important. It means the analysis result is not trapped inside the UI. A planning team could store it, compare it, audit it, or pass it into another review workflow.

If time allows, click **Spatial JSON** but do not spend time on the downloaded file.

Say:

> The exported contract is also why the product can scale beyond this demo. The model produces structured data; the interface renders and reviews it.

### 7:30-9:00 - Architecture

Action: Open **Architecture**.

Say:

> The architecture is intentionally simple. The browser is a Vite React workbench. It never calls OpenRouter directly.
>
> In AWS, CloudFront serves the frontend and routes API traffic. API Gateway invokes the Python Lambda API. The first Lambda writes a pending DynamoDB record and asynchronously invokes the worker, so the browser is not blocked by API Gateway's 30-second limit.
>
> The worker calls OpenRouter, writes status messages and progress percentages back to DynamoDB, validates the structured response with Pydantic, applies spatial sanity checks, stores the final contract in DynamoDB, and stores raw uploaded plans in a private S3 bucket when configured.

Point to **Request Path**.

Say:

> The request path is browser, CloudFront, API Gateway, Lambda, DynamoDB, raw-plan S3, and OpenRouter behind the backend boundary. The browser polls the plan record until it becomes ready or failed, and the Recent Plans list reads the same shared queue.

Point to **Runtime Layers**.

Say:

> The runtime layers are deliberately standard: Vite, React, TypeScript on the frontend; FastAPI through Lambda on the backend; OpenRouter structured-output processing for the floor-plan interpretation.

Point to **Boundary Rules**.

Say:

> The boundary rules matter for institutional users. Public access is limited to CloudFront and API Gateway. S3 buckets remain private. The backend owns the AI call and error handling.

Action: Click **Inspect diagram** if useful.

Say:

> The architecture diagram is there for technical reviewers. It shows that this is not a browser-only prototype and not a direct client-to-model integration.

### 9:00-10:00 - Close

Action: Return to **Workspace** or keep the architecture screen visible.

Say:

> Spatial Stack is built for a specific operational problem: institutions receive many 2D plans, but 3D review is slow and specialist-dependent.
>
> The workflow is simple: load a plan, run backend analysis, inspect the generated spatial model, compare it with the original source, use tools for measurement and presentation, and export the structured contract.
>
> The key separation is clear: OpenRouter interprets the source plan, Python validates the model output with both contract and sanity checks, the backend controls the model boundary and storage, the browser renders the workbench, and the planner remains responsible for verification.
>
> That is the hackathon value: faster spatial understanding without pretending the tool replaces professional review, CAD authority, or compliance sign-off.

## Demo Recovery Notes

- If the sample cards do not show, confirm the backend is running and use **Upload floor plan** with `backend/sample_files/C1.jpg`.
- If the API returns `OPENROUTER_API_KEY is required`, explain that the prototype intentionally fails closed instead of showing a fake layout. For judging, use an environment with `OPENROUTER_API_KEY` configured.
- If analysis stays pending locally, explain that the backend has saved the job record and the UI is polling `GET /plans/{planId}`. Check the backend logs for `api.analysis.status` and `openrouter.request.start`.
- If analysis stays pending in AWS, explain that deployed analysis is asynchronous: the first Lambda returns quickly, the worker finishes analysis, and the frontend polls DynamoDB through `GET /plans/{planId}`. The shared queue is visible through `GET /plans`.
- If the model output is malformed or spatially weak, explain that the backend returns an explicit failure. It does not switch to fake geometry.
- If a run produces imperfect room labels or odd furniture placement, frame that as the reason the original plan preview and planner verification step exist. The product is a review accelerator, not an autonomous planning authority.
- If the PDF sample is used, mention that the backend renders the first PDF page to JPEG before model analysis.

## What Not To Say

- Do not say: "The browser calls OpenRouter." Say: "The browser calls the backend API; the backend calls OpenRouter."
- Do not say: "The app creates guaranteed construction dimensions." Say: "The app creates model-derived dimensions that planners can review against the source plan."
- Do not say: "This replaces CAD or BIM." Say: "This accelerates early spatial review before specialist CAD or BIM work."
- Do not say: "The model is always correct." Say: "The model produces an inspectable spatial contract that the planner verifies."
- Do not say: "The app falls back to a fake layout if OpenRouter fails." Say: "The app returns an explicit error if the configured OpenRouter model cannot produce a trustworthy contract."
- Do not say: "Furniture fit is code compliance." Say: "Furniture fit is a planning aid for usability and layout review."
- Do not say: "Sightline continuity is accessibility certification." Say: "Sightline continuity is a quick spatial-read metric, not a formal accessibility audit."
- Do not say: "Sun controls are energy simulation." Say: "Sun controls provide orientation and presentation context, not energy-model results."
- Do not say: "The export is just a screenshot." Say: "The app can export both a visual scene and the structured spatial JSON contract."
