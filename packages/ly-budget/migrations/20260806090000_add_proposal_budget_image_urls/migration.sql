-- Add a multi-image field while retaining budgetImageUrl for backwards compatibility.
ALTER TABLE "Proposal"
ADD COLUMN "budget_image_urls" JSONB NOT NULL DEFAULT '[]';

-- Preserve every existing single image as the first entry in the new array.
UPDATE "Proposal"
SET "budget_image_urls" = jsonb_build_array(BTRIM("budgetImageUrl"))
WHERE NULLIF(BTRIM("budgetImageUrl"), '') IS NOT NULL;
