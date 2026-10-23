UPDATE "messages"
SET "main_visible" = true, "version" = "version" + 1, "updated_at" = now()
WHERE "role" = 'assistant'
  AND "task_id" IS NOT NULL
  AND NOT "main_visible"
  AND NULLIF("metadata"->>'secureEntryRequestId', '') IS NOT NULL;
