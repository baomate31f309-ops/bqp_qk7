DELETE FROM drafts;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'content'
    ) THEN
        UPDATE documents SET content = '';
    END IF;
END $$;

ALTER TABLE drafts DROP COLUMN IF EXISTS content;
ALTER TABLE documents DROP COLUMN IF EXISTS content;
DROP TABLE IF EXISTS document_templates;
