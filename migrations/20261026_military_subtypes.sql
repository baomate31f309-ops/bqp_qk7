ALTER TABLE drafts DROP CONSTRAINT IF EXISTS drafts_check;
ALTER TABLE drafts DROP CONSTRAINT IF EXISTS drafts_course_subtype_check;
ALTER TABLE drafts ADD CONSTRAINT drafts_course_subtype_check CHECK (
    (course_type = 'Quân sự' AND course_subtype IN ('Pháo binh', 'Công binh', 'Bộ binh', 'Trinh sát', 'Thông tin', 'SPG', 'Cối 60', 'Cối 80', 'Pháo', 'Công', 'Bộ', 'TT', 'Phòng không')) OR
    (course_type = 'Chính trị' AND course_subtype = '') OR
    (course_type = 'Hậu cần kỹ thuật' AND course_subtype IN ('Quân nhu', 'Doanh trại', 'Quân y'))
);

ALTER TABLE word_templates DROP CONSTRAINT IF EXISTS word_templates_check;
ALTER TABLE word_templates DROP CONSTRAINT IF EXISTS word_templates_course_subtype_check;
ALTER TABLE word_templates ADD CONSTRAINT word_templates_course_subtype_check CHECK (
    (course_type = 'Quân sự' AND course_subtype IN ('', 'Pháo binh', 'Công binh', 'Bộ binh', 'Trinh sát', 'Thông tin', 'SPG', 'Cối 60', 'Cối 80', 'Pháo', 'Công', 'Bộ', 'TT', 'Phòng không')) OR
    (course_type = 'Chính trị' AND course_subtype = '') OR
    (course_type = 'Hậu cần kỹ thuật' AND course_subtype IN ('', 'Quân nhu', 'Doanh trại', 'Quân y'))
);

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_check;
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_course_subtype_check;
ALTER TABLE documents ADD CONSTRAINT documents_course_subtype_check CHECK (
    (course_type = 'Quân sự' AND course_subtype IN ('Pháo binh', 'Công binh', 'Bộ binh', 'Trinh sát', 'Thông tin', 'SPG', 'Cối 60', 'Cối 80', 'Pháo', 'Công', 'Bộ', 'TT', 'Phòng không')) OR
    (course_type = 'Chính trị' AND course_subtype = '') OR
    (course_type = 'Hậu cần kỹ thuật' AND course_subtype IN ('Quân nhu', 'Doanh trại', 'Quân y'))
);
