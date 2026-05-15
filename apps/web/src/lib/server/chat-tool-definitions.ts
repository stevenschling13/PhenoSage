import "server-only";

// Tool definitions exposed to OpenAI. Extracted from chat-tools.ts
// to keep the executor module under a manageable size — pure data,
// no behavior. The matching argument schemas + handlers live in
// chat-tools.ts; the matching system-prompt copy lives in chat-prompt.ts.

export const CHAT_TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "list_grows",
      description:
        "List the user's grows (most recently updated first). Use when the user references a grow but you don't yet know which one, or to find candidate grows by stage.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max grows to return. Default 10, max 25.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_plants",
      description:
        "List plants in a given grow. Returns id, name, strain, batch label, notes.",
      parameters: {
        type: "object",
        properties: {
          growId: { type: "string", description: "Grow ID to scope to." },
          limit: { type: "number", description: "Max plants. Default 25." },
        },
        required: ["growId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_recent_findings",
      description:
        "Return the most recent plant findings (diagnoses from image analysis) for a grow or plant. Use to ground advice in observed evidence.",
      parameters: {
        type: "object",
        properties: {
          growId: { type: "string" },
          plantId: { type: "string" },
          limit: { type: "number", description: "Max findings. Default 10." },
          sinceDays: {
            type: "number",
            description: "Only findings within the last N days. Default 30.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_recent_observations",
      description:
        "Return the most recent grower-recorded plant observations (height, notes) for a grow or plant.",
      parameters: {
        type: "object",
        properties: {
          growId: { type: "string" },
          plantId: { type: "string" },
          limit: {
            type: "number",
            description: "Max observations. Default 10.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_grow_events",
      description:
        "Return recent grow events (water, feed, top, lst, defoliate, transplant, ipm, harvest, observation, note, etc.) for a grow or plant. Critical for diagnosing watering / feeding / training issues.",
      parameters: {
        type: "object",
        properties: {
          growId: { type: "string" },
          plantId: { type: "string" },
          limit: { type: "number", description: "Max events. Default 15." },
          sinceDays: { type: "number", description: "Default 14." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_latest_analysis",
      description:
        "Return the most recent image analysis (overall health score, summary, comparison summary) for a plant.",
      parameters: {
        type: "object",
        properties: {
          plantId: { type: "string" },
        },
        required: ["plantId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_analysis_history",
      description:
        "Return the recent image-analysis history for a plant (newest first) so you can describe trends over time. Each row includes overall_health_score, summary, comparison_summary, model_version, and created_at — use these to discuss progression, regression, or stability.",
      parameters: {
        type: "object",
        properties: {
          plantId: { type: "string" },
          limit: {
            type: "number",
            description: "Max history rows. Default 8, max 20.",
          },
        },
        required: ["plantId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "log_grow_event",
      description:
        "Record a cultivation action the grower just performed: water, feed, top, fim, lst, defoliate, transplant, ipm (pest treatment), harvest, observation, note, other. Use this when the user describes something they DID — 'I just watered tent 2', 'fed plant 3 with FloraNova at 800 EC', 'topped #4 above the 5th node'. Always confirm the grow (and plant, if specific) and the event_type before calling. The event is attributed to the current user and timestamped to now unless occurredAt is supplied. Returns the new event id.",
      parameters: {
        type: "object",
        properties: {
          growId: {
            type: "string",
            description:
              "Grow ID the event belongs to. Required. If unknown, call list_grows first.",
          },
          plantId: {
            type: "string",
            description:
              "Optional plant ID when the action targeted a single plant. Omit for whole-grow events (e.g. environmental adjustments).",
          },
          eventType: {
            type: "string",
            enum: [
              "water",
              "feed",
              "top",
              "fim",
              "lst",
              "defoliate",
              "transplant",
              "ipm",
              "harvest",
              "observation",
              "note",
              "other",
            ],
            description:
              "Event category. Pick the most specific match. Use 'other' only when no category fits.",
          },
          notes: {
            type: "string",
            description:
              "Free-text detail (product, dose, EC/pH, observed runoff, branch trained, etc.). Up to 2000 chars.",
          },
          occurredAt: {
            type: "string",
            description:
              "ISO 8601 timestamp the action actually happened. Omit to use now. Cannot be in the future.",
          },
        },
        required: ["growId", "eventType"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "log_plant_observation",
      description:
        "Record a manual observation about a single plant — typically height in cm and/or a free-text note ('node 5 inter-nodal spacing tightening, pistils fattening'). Use when the user reports a measurement or qualitative observation. Returns the new observation id.",
      parameters: {
        type: "object",
        properties: {
          plantId: {
            type: "string",
            description: "Plant ID being observed. Required.",
          },
          growId: {
            type: "string",
            description:
              "Grow ID the plant belongs to. Required so the row can be RLS-checked.",
          },
          heightCm: {
            type: "number",
            description:
              "Height in centimetres (numeric, two decimals). Omit if not measured.",
          },
          notes: {
            type: "string",
            description:
              "Free-text observation (up to 2000 chars). At least one of heightCm or notes must be supplied.",
          },
          observedAt: {
            type: "string",
            description:
              "ISO 8601 timestamp the observation was made. Omit to use now. Cannot be in the future.",
          },
        },
        required: ["plantId", "growId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "mark_finding_resolved",
      description:
        "Mark an AI-generated plant finding as resolved (or re-open it). Use when the user confirms they've addressed an issue ('I flushed the deficiency yesterday and it looks better' → mark the matching nutrient_deficiency finding resolved) or wants to re-open one they thought was fixed. Resolution sets `resolved_at` to now (or a supplied timestamp); re-opening clears it. You can only modify this field — severity, category, and description are immutable.",
      parameters: {
        type: "object",
        properties: {
          findingId: {
            type: "string",
            description:
              "Finding ID to update. Required. If you don't know it, call get_recent_findings first.",
          },
          resolved: {
            type: "boolean",
            description:
              "true to mark resolved (sets resolved_at), false to re-open (clears resolved_at). Required.",
          },
          resolvedAt: {
            type: "string",
            description:
              "ISO 8601 timestamp the issue was actually resolved. Omit to use now. Ignored when resolved=false. Cannot be in the future.",
          },
        },
        required: ["findingId", "resolved"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_grow_stage",
      description:
        "Transition the entire grow to a new growth stage. Use when the user says they switched the room/tent — 'I flipped the tent to flower yesterday', 'moved everyone to veg'. Stage is a property of the GROW, not individual plants (schema constraint today), so this affects every plant in that grow. Only grow OWNERS can change stage today (collaborators get a permission error). Returns the updated stage.",
      parameters: {
        type: "object",
        properties: {
          growId: {
            type: "string",
            description: "Grow ID to update. Required.",
          },
          stage: {
            type: "string",
            enum: [
              "germination",
              "seedling",
              "vegetative",
              "pre_flower",
              "flower",
              "late_flower",
              "harvest",
              "dry_cure",
            ],
            description:
              "New stage. Use 'pre_flower' for the stretch / first-pistils transition, 'late_flower' for the final 2-3 weeks before harvest, 'dry_cure' for post-harvest dry+cure.",
          },
        },
        required: ["growId", "stage"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_open_tasks",
      description:
        "List actionable tasks for a grow or plant. Tasks are auto-created from high/critical AI findings, and may also be created manually. Use to surface what the grower should do next, or to ground a reply in their actual worklist. Returns open + in_progress tasks by default, newest urgent first.",
      parameters: {
        type: "object",
        properties: {
          growId: {
            type: "string",
            description:
              "Grow ID to scope to. Either growId or plantId is required.",
          },
          plantId: {
            type: "string",
            description:
              "Plant ID to scope to (filters tasks where plant_id matches). Either growId or plantId is required.",
          },
          includeCompleted: {
            type: "boolean",
            description:
              "Set true to include done + dismissed tasks too. Default false (only open + in_progress).",
          },
          limit: {
            type: "number",
            description: "Max tasks. Default 10, max 25.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_task_status",
      description:
        "Transition a grow_task to a new status — typically 'done' when the grower says they completed the action, or 'dismissed' when the task no longer applies (e.g. a false-positive finding). Setting status to 'done' or 'dismissed' stamps completed_at; setting it back to 'open' or 'in_progress' clears completed_at. Returns the updated task. Owner + collaborator only.",
      parameters: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Task ID to update. Required.",
          },
          status: {
            type: "string",
            enum: ["open", "in_progress", "done", "dismissed"],
            description: "New status. Required.",
          },
        },
        required: ["taskId", "status"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_grow",
      description:
        "Create a new grow record on the user's behalf. Use when the user wants to set up a brand-new tent / room / cultivation program — 'start a new grow called North Tent in soil under LED', 'I'm beginning week 1 of a hydro flower run, set it up'. Always confirm at least name + stage + medium + light before calling. The grow is owned by the current user. Returns the new grow id and name so follow-up tools (create_plants, etc.) can reference it.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "Operator-facing grow name (1-120 chars). Required. Examples: 'North Tent A', 'Greenhouse Spring 2026', 'Veg Room B'.",
          },
          stage: {
            type: "string",
            enum: [
              "germination",
              "seedling",
              "vegetative",
              "pre_flower",
              "flower",
              "late_flower",
              "harvest",
              "dry_cure",
            ],
            description:
              "Current stage. Pick the most specific match for what the grower is doing today (default to 'seedling' for a fresh start when unclear).",
          },
          medium: {
            type: "string",
            enum: ["soil", "coco", "hydro", "aero", "living_soil", "other"],
            description: "Cultivation medium.",
          },
          lightType: {
            type: "string",
            enum: ["hps", "cmh", "led", "t5", "sun", "mixed", "other"],
            description: "Primary light source.",
          },
          startDate: {
            type: "string",
            description:
              "ISO 8601 date (YYYY-MM-DD) the grow began. Omit to default to today. Cannot be more than 1 day in the future.",
          },
          targetHarvestDate: {
            type: "string",
            description:
              "Optional ISO 8601 date (YYYY-MM-DD) the grower is aiming to harvest. Must be on or after startDate.",
          },
          description: {
            type: "string",
            description:
              "Optional free-text notes about the room / cultivar / facility (up to 2000 chars).",
          },
        },
        required: ["name", "stage", "medium", "lightType"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_plants",
      description:
        "Create one or more plant records inside an existing grow. Use immediately after create_grow when the user describes how many plants they're running, or any time they say 'add N plants to <grow>'. When count > 1, names are auto-suffixed with zero-padded numbers (e.g. 'Plant 01', 'Plant 02'; 'NL 10' two-digit padding when count >= 10). Returns the list of created plant ids and names so the model can reference specific plants in follow-up.",
      parameters: {
        type: "object",
        properties: {
          growId: {
            type: "string",
            description:
              "Target grow ID. Required. If unknown, call list_grows first.",
          },
          name: {
            type: "string",
            description:
              "Plant name (count=1) or name prefix (count>1). 1-115 chars; the bulk path appends ' NN' so keep room for the suffix.",
          },
          count: {
            type: "number",
            description:
              "How many plants to create. Default 1. Maximum 25 per call.",
          },
          strain: {
            type: "string",
            description:
              "Optional cultivar / strain name applied to every plant created in this call.",
          },
          batchLabel: {
            type: "string",
            description:
              "Optional tray or batch reference applied to every plant.",
          },
          notes: {
            type: "string",
            description:
              "Optional free-text notes applied to every plant (up to 2000 chars).",
          },
        },
        required: ["growId", "name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_grow_task",
      description:
        "Create a manual task in a grow's worklist. Use when the user asks for a reminder, follow-up action, or to capture something they need to do later — 'remind me to flush in 3 days', 'add a task to check trichomes Friday'. Tasks auto-created from AI findings already exist; this tool is for grower-initiated reminders only. Returns the new task id.",
      parameters: {
        type: "object",
        properties: {
          growId: {
            type: "string",
            description:
              "Grow ID the task belongs to. Required. If unknown, call list_grows first.",
          },
          plantId: {
            type: "string",
            description:
              "Optional plant ID when the task targets a single plant.",
          },
          title: {
            type: "string",
            description:
              "Short, action-oriented title (1-200 chars). Examples: 'Flush plants 3 and 4', 'Check trichomes Friday'.",
          },
          description: {
            type: "string",
            description: "Optional longer detail (up to 2000 chars).",
          },
          priority: {
            type: "string",
            enum: ["low", "medium", "high", "urgent"],
            description:
              "Task priority. Default 'medium'. Use 'urgent' only when the grower flags an immediate issue.",
          },
          dueAt: {
            type: "string",
            description:
              "Optional ISO 8601 datetime when the task is due. Must be in the future.",
          },
        },
        required: ["growId", "title"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_grow",
      description:
        "Update a grow's mutable metadata — rename it, edit the description, fix the medium / light_type, set or clear the target harvest date, or archive / un-archive it. Use when the user wants to correct a mistake ('rename the Test grow to North Tent'), evolve the program ('we switched to coco'), or wrap up the cycle ('archive the spring 2026 run'). Stage transitions go through update_grow_stage, not this tool. Pass only the fields the user actually wants to change — omitted fields are left untouched. At least one mutable field is required. Owner only.",
      parameters: {
        type: "object",
        properties: {
          growId: {
            type: "string",
            description: "Grow ID to update. Required.",
          },
          name: {
            type: "string",
            description:
              "New grow name (1-120 chars). Omit to leave unchanged.",
          },
          description: {
            type: "string",
            description:
              "Replacement free-text description (up to 2000 chars). Pass an empty string to clear an existing description; omit to leave unchanged.",
          },
          medium: {
            type: "string",
            enum: ["soil", "coco", "hydro", "aero", "living_soil", "other"],
            description: "New cultivation medium. Omit to leave unchanged.",
          },
          lightType: {
            type: "string",
            enum: ["hps", "cmh", "led", "t5", "sun", "mixed", "other"],
            description: "New primary light source. Omit to leave unchanged.",
          },
          targetHarvestDate: {
            type: "string",
            description:
              "ISO 8601 date (YYYY-MM-DD) the grower is now aiming to harvest. Pass an empty string to clear an existing target; omit to leave unchanged.",
          },
          archived: {
            type: "boolean",
            description:
              "true to archive the grow (soft-delete; plants + history stay readable), false to un-archive it. Omit to leave unchanged.",
          },
        },
        required: ["growId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_plant",
      description:
        "Update a plant's mutable metadata — rename it, set/replace the strain, batch label, or notes, or archive / un-archive it. Use when the user wants to correct a name from a bulk create ('rename Plant 03 to Mother'), tag a phenotype ('strain is Northern Lights #5'), or retire a plant ('archive Plant 02, it died'). Pass only the fields the user actually wants to change — omitted fields are left untouched. At least one mutable field is required. Owner only.",
      parameters: {
        type: "object",
        properties: {
          plantId: {
            type: "string",
            description: "Plant ID to update. Required.",
          },
          name: {
            type: "string",
            description:
              "New plant name (1-120 chars). Omit to leave unchanged.",
          },
          strain: {
            type: "string",
            description:
              "Replacement cultivar / strain name. Pass an empty string to clear; omit to leave unchanged.",
          },
          batchLabel: {
            type: "string",
            description:
              "Replacement batch / tray reference. Pass an empty string to clear; omit to leave unchanged.",
          },
          notes: {
            type: "string",
            description:
              "Replacement free-text notes (up to 2000 chars). Pass an empty string to clear; omit to leave unchanged.",
          },
          archived: {
            type: "boolean",
            description:
              "true to archive the plant (soft-delete; image history + findings stay readable), false to un-archive it. Omit to leave unchanged.",
          },
        },
        required: ["plantId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_similar_findings",
      description:
        "Search semantically similar historical plant_findings within the active grow. Use when the user asks whether a symptom, deficiency, pest, disease, or recommendation resembles something seen before in this same grow. Server-only retrieval; do not use for cross-grow memory.",
      parameters: {
        type: "object",
        properties: {
          growId: {
            type: "string",
            description: "Active grow ID to search within. Required.",
          },
          query: {
            type: "string",
            description:
              "Natural-language symptom or finding description to compare against past findings in this grow.",
          },
          limit: {
            type: "number",
            description:
              "Maximum matches to return. Defaults to 5, capped at 10.",
          },
        },
        required: ["growId", "query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "record_image_finding",
      description:
        "File a structured plant_findings row when the user describes a plant-health issue they've observed — typically tied to a photo they just uploaded. Use this for definite diagnoses ('there's brown spots on Plant 4's middle fans, looks like septoria'), not for casual notes (use log_plant_observation for that). The row is tagged source='user_reported' to distinguish it from AI-generated findings, and the existing auto-task trigger will create an open grow_task automatically if severity is high or critical. Owner + collaborator only. Returns the new finding id.",
      parameters: {
        type: "object",
        properties: {
          plantId: {
            type: "string",
            description: "Plant ID the finding is about. Required.",
          },
          growId: {
            type: "string",
            description:
              "Grow ID the plant belongs to. Required so the row can be RLS-checked.",
          },
          category: {
            type: "string",
            enum: [
              "nutrient_deficiency",
              "nutrient_toxicity",
              "pest",
              "disease",
              "environmental",
              "training",
              "general",
              "positive",
            ],
            description:
              "Finding category. Pick the most specific match. 'general' is the catch-all when nothing fits; 'positive' is for confirming things are going right.",
          },
          severity: {
            type: "string",
            enum: ["info", "low", "medium", "high", "critical"],
            description:
              "How urgent this is. high + critical auto-create an open grow_task via the existing trigger — reserve those for issues that need action soon.",
          },
          title: {
            type: "string",
            description:
              "Short, headline-style title (1-200 chars). Examples: 'Early N deficiency on lower fans', 'Suspected spider mites under leaves'.",
          },
          description: {
            type: "string",
            description:
              "Longer detail (up to 2000 chars). What was observed, where on the plant, in what context.",
          },
          recommendation: {
            type: "string",
            description:
              "Optional suggested action (up to 2000 chars). Becomes the body of the auto-created task when severity is high/critical.",
          },
          imageId: {
            type: "string",
            description:
              "Optional plant_image ID this finding refers to. Omit if not tied to a specific image.",
          },
        },
        required: ["plantId", "growId", "category", "severity", "title"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_plant_timeline",
      description:
        "Return the unified time-ordered timeline of a plant — images, observations, AI findings, and analysis summaries merged in one feed. Use when the user asks a question that needs cross-source history ('how has Plant 3 progressed this week?', 'when did we last water this one?', 'show me everything that's happened to plant 4'). Newest items first. Returns up to `limit` items.",
      parameters: {
        type: "object",
        properties: {
          plantId: {
            type: "string",
            description: "Plant ID to read. Required.",
          },
          limit: {
            type: "number",
            description:
              "Max items to return. Default 20, max 50. The model should request the smallest useful window to stay within token budget.",
          },
        },
        required: ["plantId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "trigger_plant_analysis",
      description:
        "Run the AI vision analysis pipeline on a plant photo and persist the result. Use when the user just uploaded a photo and wants immediate diagnostic feedback, or asks 'analyze this again with the new context'. By default analyzes the most recent image; pass imageId to analyze a specific historical image. The call is synchronous and may take 5-30 seconds — narrate that to the user before invoking. Returns the new analysis row (overall_health_score, summary, comparison_summary, findings count). RLS-scoped: the user must own or collaborate on the plant's grow.",
      parameters: {
        type: "object",
        properties: {
          plantId: {
            type: "string",
            description: "Plant ID to analyze. Required.",
          },
          imageId: {
            type: "string",
            description:
              "Specific image to analyze. Omit to use the most recent image. Useful for re-analyzing a historical capture in light of new context.",
          },
        },
        required: ["plantId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "find_grow",
      description:
        "Resolve a free-text reference to a grow ('north tent', 'the spring run', 'soil hydro') into one or more candidate grow ids. Use as the FIRST step when the user mentions a grow conversationally so you can avoid an awkward 'which grow?' round-trip. Case-insensitive substring match on grow name + description, ordered by most recently updated. Returns up to `limit` candidates; if exactly one matches, the model can confidently proceed.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Free-text reference from the user (1-120 chars). Examples: 'north tent', 'spring 2026', 'flower room'.",
          },
          includeArchived: {
            type: "boolean",
            description:
              "Set true to include archived grows. Default false — most resolution queries should ignore archived rows.",
          },
          limit: {
            type: "number",
            description:
              "Max candidates to return. Default 5, max 15. Smaller is better — narrow the search if you get too many.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "find_plant",
      description:
        "Resolve a free-text reference to a plant ('the mother', 'plant 3', 'NL 01', 'phenotype A') into one or more candidate plant ids. Use as the FIRST step when the user mentions a plant conversationally. Case-insensitive substring match across plants.name, strain, and batch_label; optionally scoped to a grow. Ordered by most recently updated. Returns up to `limit` candidates with their grow id so follow-up tools can be called immediately.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Free-text reference from the user (1-120 chars). Examples: 'the mother', 'NL 01', 'phenotype A', 'plant 3'.",
          },
          growId: {
            type: "string",
            description:
              "Optional grow ID to constrain the search. Use this when you already know which grow the user is talking about.",
          },
          includeArchived: {
            type: "boolean",
            description: "Set true to include archived plants. Default false.",
          },
          limit: {
            type: "number",
            description: "Max candidates. Default 5, max 15.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "compare_plants",
      description:
        "Side-by-side comparison of 2-4 plants over a recent window. Returns each plant's latest analysis summary (health score, summary, comparison_summary) plus event / observation / open-task / unresolved-finding counts since `sinceDays`. Use for cross-plant longitudinal questions: 'how does plant 3 compare to plant 4 this week', 'which of the seedlings is lagging', 'is the LED tent doing better than the HPS tent overall'. Cheaper than calling get_plant_timeline for each plant — one call returns the comparable summary fields.",
      parameters: {
        type: "object",
        properties: {
          plantIds: {
            type: "array",
            items: { type: "string" },
            description: "2-4 plant ids to compare. Required.",
          },
          sinceDays: {
            type: "number",
            description:
              "Activity window for the counts (events, observations, findings). Default 14, max 90.",
          },
        },
        required: ["plantIds"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_grow_summary",
      description:
        "Whole-grow snapshot in one call — grow metadata (stage, medium, light, days since start), plant count, open-task count broken down by priority, unresolved-finding count broken down by severity, and the most recent event / observation timestamps. Use to answer 'how's the north tent doing overall?' or as a fast first read before deeper investigation. Replaces several separate read tool chains.",
      parameters: {
        type: "object",
        properties: {
          growId: {
            type: "string",
            description: "Grow ID to summarise. Required.",
          },
        },
        required: ["growId"],
        additionalProperties: false,
      },
    },
  },
];
