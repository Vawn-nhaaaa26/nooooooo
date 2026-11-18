IF DB_NAME() = N'master'
    USE [bkspacetech_cms];

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

IF OBJECT_ID(N'dbo.roles', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.roles (
        id NVARCHAR(64) NOT NULL CONSTRAINT PK_roles PRIMARY KEY,
        name NVARCHAR(200) NOT NULL CONSTRAINT UQ_roles_name UNIQUE,
        description NVARCHAR(1000) NOT NULL CONSTRAINT DF_roles_description DEFAULT N'',
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_roles_created_at DEFAULT SYSUTCDATETIME()
    );
END;

IF OBJECT_ID(N'dbo.permissions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.permissions (
        id NVARCHAR(128) NOT NULL CONSTRAINT PK_permissions PRIMARY KEY,
        name NVARCHAR(200) NOT NULL CONSTRAINT UQ_permissions_name UNIQUE,
        description NVARCHAR(1000) NOT NULL CONSTRAINT DF_permissions_description DEFAULT N''
    );
END;

IF OBJECT_ID(N'dbo.role_permissions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.role_permissions (
        role_id NVARCHAR(64) NOT NULL,
        permission_id NVARCHAR(128) NOT NULL,
        CONSTRAINT PK_role_permissions PRIMARY KEY (role_id, permission_id),
        CONSTRAINT FK_role_permissions_roles FOREIGN KEY (role_id) REFERENCES dbo.roles(id),
        CONSTRAINT FK_role_permissions_permissions FOREIGN KEY (permission_id) REFERENCES dbo.permissions(id)
    );
END;

IF OBJECT_ID(N'dbo.departments', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.departments (
        id NVARCHAR(128) NOT NULL CONSTRAINT PK_departments PRIMARY KEY,
        name NVARCHAR(200) NOT NULL CONSTRAINT UQ_departments_name UNIQUE,
        description NVARCHAR(2000) NOT NULL CONSTRAINT DF_departments_description DEFAULT N'',
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_departments_created_at DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_departments_updated_at DEFAULT SYSUTCDATETIME()
    );
END;

IF OBJECT_ID(N'dbo.users', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.users (
        id NVARCHAR(128) NOT NULL CONSTRAINT PK_users PRIMARY KEY,
        email NVARCHAR(320) COLLATE Latin1_General_100_CI_AS NOT NULL CONSTRAINT UQ_users_email UNIQUE,
        full_name NVARCHAR(200) NOT NULL,
        google_sub NVARCHAR(255) NULL,
        role_id NVARCHAR(64) NOT NULL,
        department_id NVARCHAR(128) NULL,
        is_active BIT NOT NULL CONSTRAINT DF_users_is_active DEFAULT 1,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_users_created_at DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_users_updated_at DEFAULT SYSUTCDATETIME(),
        last_login_at DATETIME2(3) NULL,
        CONSTRAINT FK_users_roles FOREIGN KEY (role_id) REFERENCES dbo.roles(id),
        CONSTRAINT FK_users_departments FOREIGN KEY (department_id) REFERENCES dbo.departments(id)
    );
END;

IF OBJECT_ID(N'dbo.categories', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.categories (
        id NVARCHAR(128) NOT NULL CONSTRAINT PK_categories PRIMARY KEY,
        name NVARCHAR(200) NOT NULL CONSTRAINT UQ_categories_name UNIQUE,
        slug NVARCHAR(250) NOT NULL CONSTRAINT UQ_categories_slug UNIQUE,
        description NVARCHAR(2000) NOT NULL CONSTRAINT DF_categories_description DEFAULT N'',
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_categories_created_at DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_categories_updated_at DEFAULT SYSUTCDATETIME()
    );
END;

IF OBJECT_ID(N'dbo.members', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.members (
        id NVARCHAR(128) NOT NULL CONSTRAINT PK_members PRIMARY KEY,
        user_id NVARCHAR(128) NULL,
        department_id NVARCHAR(128) NULL,
        full_name NVARCHAR(200) NOT NULL,
        student_id NVARCHAR(64) NULL,
        email NVARCHAR(320) NULL,
        position NVARCHAR(300) NOT NULL CONSTRAINT DF_members_position DEFAULT N'',
        generation NVARCHAR(100) NOT NULL CONSTRAINT DF_members_generation DEFAULT N'',
        initials NVARCHAR(32) NOT NULL CONSTRAINT DF_members_initials DEFAULT N'',
        is_executive BIT NOT NULL CONSTRAINT DF_members_is_executive DEFAULT 0,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_members_created_at DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_members_updated_at DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_members_users FOREIGN KEY (user_id) REFERENCES dbo.users(id),
        CONSTRAINT FK_members_departments FOREIGN KEY (department_id) REFERENCES dbo.departments(id)
    );
END;

IF OBJECT_ID(N'dbo.posts', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.posts (
        id NVARCHAR(128) NOT NULL CONSTRAINT PK_posts PRIMARY KEY,
        category_id NVARCHAR(128) NULL,
        author_id NVARCHAR(128) NULL,
        title NVARCHAR(500) NOT NULL,
        slug NVARCHAR(450) NOT NULL CONSTRAINT UQ_posts_slug UNIQUE,
        excerpt NVARCHAR(MAX) NOT NULL CONSTRAINT DF_posts_excerpt DEFAULT N'',
        content NVARCHAR(MAX) NOT NULL CONSTRAINT DF_posts_content DEFAULT N'',
        status NVARCHAR(32) NOT NULL CONSTRAINT DF_posts_status DEFAULT N'draft',
        review_note NVARCHAR(MAX) NOT NULL CONSTRAINT DF_posts_review_note DEFAULT N'',
        published_at NVARCHAR(100) NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_posts_created_at DEFAULT SYSUTCDATETIME(),
        updated_at NVARCHAR(100) NOT NULL CONSTRAINT DF_posts_updated_at DEFAULT N'',
        CONSTRAINT CK_posts_status CHECK (status IN (N'draft', N'pending_review', N'published', N'archived')),
        CONSTRAINT FK_posts_categories FOREIGN KEY (category_id) REFERENCES dbo.categories(id),
        CONSTRAINT FK_posts_users FOREIGN KEY (author_id) REFERENCES dbo.users(id)
    );
END;

IF OBJECT_ID(N'dbo.projects', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.projects (
        id NVARCHAR(128) NOT NULL CONSTRAINT PK_projects PRIMARY KEY,
        department_id NVARCHAR(128) NULL,
        lead_member_id NVARCHAR(128) NULL,
        name NVARCHAR(300) NOT NULL,
        summary NVARCHAR(MAX) NOT NULL CONSTRAINT DF_projects_summary DEFAULT N'',
        result NVARCHAR(MAX) NOT NULL CONSTRAINT DF_projects_result DEFAULT N'',
        status NVARCHAR(32) NOT NULL CONSTRAINT DF_projects_status DEFAULT N'planned',
        progress INT NOT NULL CONSTRAINT DF_projects_progress DEFAULT 0,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_projects_created_at DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_projects_updated_at DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_projects_status CHECK (status IN (N'planned', N'in_progress', N'testing', N'completed', N'archived')),
        CONSTRAINT CK_projects_progress CHECK (progress BETWEEN 0 AND 100),
        CONSTRAINT FK_projects_departments FOREIGN KEY (department_id) REFERENCES dbo.departments(id),
        CONSTRAINT FK_projects_members FOREIGN KEY (lead_member_id) REFERENCES dbo.members(id)
    );
END;

IF OBJECT_ID(N'dbo.activities', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.activities (
        id NVARCHAR(128) NOT NULL CONSTRAINT PK_activities PRIMARY KEY,
        department_id NVARCHAR(128) NULL,
        title NVARCHAR(500) NOT NULL,
        activity_type NVARCHAR(32) NOT NULL CONSTRAINT DF_activities_type DEFAULT N'event',
        description NVARCHAR(MAX) NOT NULL CONSTRAINT DF_activities_description DEFAULT N'',
        location NVARCHAR(500) NOT NULL CONSTRAINT DF_activities_location DEFAULT N'',
        starts_at NVARCHAR(100) NULL,
        ends_at NVARCHAR(100) NULL,
        capacity INT NULL,
        registered_count INT NOT NULL CONSTRAINT DF_activities_registered DEFAULT 0,
        status NVARCHAR(32) NOT NULL CONSTRAINT DF_activities_status DEFAULT N'draft',
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_activities_created_at DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_activities_updated_at DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_activities_type CHECK (activity_type IN (N'event', N'training', N'meeting', N'other')),
        CONSTRAINT CK_activities_capacity CHECK (capacity IS NULL OR capacity >= 0),
        CONSTRAINT CK_activities_registered CHECK (registered_count >= 0),
        CONSTRAINT CK_activities_status CHECK (status IN (N'draft', N'pending_review', N'published', N'cancelled', N'completed')),
        CONSTRAINT FK_activities_departments FOREIGN KEY (department_id) REFERENCES dbo.departments(id)
    );
END;

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.posts')
      AND name IN (N'published_at', N'updated_at')
      AND TYPE_NAME(user_type_id) = N'DATETIME2'
)
BEGIN
    IF EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'dbo.posts') AND name = N'idx_posts_status_published'
    )
        DROP INDEX idx_posts_status_published ON dbo.posts;

    IF EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID(N'dbo.posts')
          AND name = N'published_at'
          AND TYPE_NAME(user_type_id) = N'DATETIME2'
    )
        ALTER TABLE dbo.posts ALTER COLUMN published_at NVARCHAR(100) NULL;
    IF EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID(N'dbo.posts')
          AND name = N'updated_at'
          AND TYPE_NAME(user_type_id) = N'DATETIME2'
    )
    BEGIN
        IF EXISTS (
            SELECT 1 FROM sys.default_constraints
            WHERE parent_object_id = OBJECT_ID(N'dbo.posts')
              AND name = N'DF_posts_updated_at'
        )
            ALTER TABLE dbo.posts DROP CONSTRAINT DF_posts_updated_at;

        ALTER TABLE dbo.posts ALTER COLUMN updated_at NVARCHAR(100) NOT NULL;
        ALTER TABLE dbo.posts ADD CONSTRAINT DF_posts_updated_at DEFAULT N'' FOR updated_at;
    END;
END;

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.activities')
      AND name IN (N'starts_at', N'ends_at')
      AND TYPE_NAME(user_type_id) = N'DATETIME2'
)
BEGIN
    IF EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'dbo.activities') AND name = N'idx_activities_starts_at'
    )
        DROP INDEX idx_activities_starts_at ON dbo.activities;

    IF EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID(N'dbo.activities')
          AND name = N'starts_at'
          AND TYPE_NAME(user_type_id) = N'DATETIME2'
    )
        ALTER TABLE dbo.activities ALTER COLUMN starts_at NVARCHAR(100) NULL;
    IF EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID(N'dbo.activities')
          AND name = N'ends_at'
          AND TYPE_NAME(user_type_id) = N'DATETIME2'
    )
        ALTER TABLE dbo.activities ALTER COLUMN ends_at NVARCHAR(100) NULL;
END;

IF OBJECT_ID(N'dbo.media', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.media (
        id NVARCHAR(128) NOT NULL CONSTRAINT PK_media PRIMARY KEY,
        uploaded_by NVARCHAR(128) NULL,
        name NVARCHAR(500) NOT NULL,
        storage_key NVARCHAR(450) NOT NULL CONSTRAINT UQ_media_storage_key UNIQUE,
        media_type NVARCHAR(32) NOT NULL,
        mime_type NVARCHAR(200) NOT NULL CONSTRAINT DF_media_mime_type DEFAULT N'',
        file_size_bytes BIGINT NULL,
        width INT NULL,
        height INT NULL,
        alt_text NVARCHAR(1000) NOT NULL CONSTRAINT DF_media_alt_text DEFAULT N'',
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_media_created_at DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_media_type CHECK (media_type IN (N'image', N'video', N'document', N'other')),
        CONSTRAINT CK_media_file_size CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
        CONSTRAINT CK_media_width CHECK (width IS NULL OR width >= 0),
        CONSTRAINT CK_media_height CHECK (height IS NULL OR height >= 0),
        CONSTRAINT FK_media_users FOREIGN KEY (uploaded_by) REFERENCES dbo.users(id)
    );
END;

IF OBJECT_ID(N'dbo.sponsors', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.sponsors (
        id NVARCHAR(128) NOT NULL CONSTRAINT PK_sponsors PRIMARY KEY,
        name NVARCHAR(300) NOT NULL,
        tier NVARCHAR(100) NOT NULL CONSTRAINT DF_sponsors_tier DEFAULT N'',
        website NVARCHAR(1000) NOT NULL CONSTRAINT DF_sponsors_website DEFAULT N'',
        logo_media_id NVARCHAR(128) NULL,
        is_active BIT NOT NULL CONSTRAINT DF_sponsors_is_active DEFAULT 1,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_sponsors_created_at DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_sponsors_updated_at DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_sponsors_media FOREIGN KEY (logo_media_id) REFERENCES dbo.media(id)
    );
END;

IF OBJECT_ID(N'dbo.revisions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.revisions (
        id NVARCHAR(128) NOT NULL CONSTRAINT PK_revisions PRIMARY KEY,
        content_type NVARCHAR(32) NOT NULL,
        content_id NVARCHAR(128) NOT NULL,
        editor_id NVARCHAR(128) NULL,
        action NVARCHAR(100) NOT NULL CONSTRAINT DF_revisions_action DEFAULT N'edit',
        snapshot_json NVARCHAR(MAX) NOT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_revisions_created_at DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_revisions_content_type CHECK (content_type IN (N'post', N'project', N'activity')),
        CONSTRAINT FK_revisions_users FOREIGN KEY (editor_id) REFERENCES dbo.users(id)
    );
END;

IF OBJECT_ID(N'dbo.content_approvals', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.content_approvals (
        id NVARCHAR(128) NOT NULL CONSTRAINT PK_content_approvals PRIMARY KEY,
        post_id NVARCHAR(128) NOT NULL,
        submitted_by NVARCHAR(128) NULL,
        reviewer_id NVARCHAR(128) NULL,
        status NVARCHAR(32) NOT NULL CONSTRAINT DF_content_approvals_status DEFAULT N'pending',
        note NVARCHAR(MAX) NOT NULL CONSTRAINT DF_content_approvals_note DEFAULT N'',
        submitted_at DATETIME2(3) NOT NULL CONSTRAINT DF_content_approvals_submitted DEFAULT SYSUTCDATETIME(),
        reviewed_at DATETIME2(3) NULL,
        CONSTRAINT CK_content_approvals_status CHECK (status IN (N'pending', N'approved', N'changes_requested', N'rejected')),
        CONSTRAINT FK_content_approvals_posts FOREIGN KEY (post_id) REFERENCES dbo.posts(id),
        CONSTRAINT FK_content_approvals_submitter FOREIGN KEY (submitted_by) REFERENCES dbo.users(id),
        CONSTRAINT FK_content_approvals_reviewer FOREIGN KEY (reviewer_id) REFERENCES dbo.users(id)
    );
END;

IF OBJECT_ID(N'dbo.audit_logs', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.audit_logs (
        id NVARCHAR(128) NOT NULL CONSTRAINT PK_audit_logs PRIMARY KEY,
        actor_id NVARCHAR(128) NULL,
        actor_email NVARCHAR(320) NOT NULL CONSTRAINT DF_audit_logs_actor_email DEFAULT N'',
        action NVARCHAR(300) NOT NULL,
        target_type NVARCHAR(100) NOT NULL CONSTRAINT DF_audit_logs_target_type DEFAULT N'',
        target_id NVARCHAR(320) NOT NULL CONSTRAINT DF_audit_logs_target_id DEFAULT N'',
        details_json NVARCHAR(MAX) NOT NULL CONSTRAINT DF_audit_logs_details DEFAULT N'{}',
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_audit_logs_created_at DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_audit_logs_users FOREIGN KEY (actor_id) REFERENCES dbo.users(id)
    );
END;

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.audit_logs')
      AND name = N'created_at'
      AND is_nullable = 0
)
    ALTER TABLE dbo.audit_logs ALTER COLUMN created_at DATETIME2(3) NULL;

IF OBJECT_ID(N'dbo.cms_state', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.cms_state (
        id TINYINT NOT NULL CONSTRAINT PK_cms_state PRIMARY KEY,
        version INT NOT NULL CONSTRAINT DF_cms_state_version DEFAULT 1,
        state_json NVARCHAR(MAX) NOT NULL,
        updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_cms_state_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_cms_state_id CHECK (id = 1),
        CONSTRAINT CK_cms_state_version CHECK (version > 0)
    );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_posts_status_published' AND object_id = OBJECT_ID(N'dbo.posts'))
    CREATE INDEX idx_posts_status_published ON dbo.posts(status, published_at);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_posts_category' AND object_id = OBJECT_ID(N'dbo.posts'))
    CREATE INDEX idx_posts_category ON dbo.posts(category_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_posts_author' AND object_id = OBJECT_ID(N'dbo.posts'))
    CREATE INDEX idx_posts_author ON dbo.posts(author_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_users_role_department' AND object_id = OBJECT_ID(N'dbo.users'))
    CREATE INDEX idx_users_role_department ON dbo.users(role_id, department_id);
IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE parent_object_id = OBJECT_ID(N'dbo.users') AND name = N'UQ_users_google_sub')
    ALTER TABLE dbo.users DROP CONSTRAINT UQ_users_google_sub;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_users_google_sub' AND object_id = OBJECT_ID(N'dbo.users'))
    CREATE UNIQUE INDEX idx_users_google_sub ON dbo.users(google_sub) WHERE google_sub IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_role_permissions_permission' AND object_id = OBJECT_ID(N'dbo.role_permissions'))
    CREATE INDEX idx_role_permissions_permission ON dbo.role_permissions(permission_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_projects_department' AND object_id = OBJECT_ID(N'dbo.projects'))
    CREATE INDEX idx_projects_department ON dbo.projects(department_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_projects_lead_member' AND object_id = OBJECT_ID(N'dbo.projects'))
    CREATE INDEX idx_projects_lead_member ON dbo.projects(lead_member_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_activities_starts_at' AND object_id = OBJECT_ID(N'dbo.activities'))
    CREATE INDEX idx_activities_starts_at ON dbo.activities(starts_at);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_activities_department_status' AND object_id = OBJECT_ID(N'dbo.activities'))
    CREATE INDEX idx_activities_department_status ON dbo.activities(department_id, status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_members_department' AND object_id = OBJECT_ID(N'dbo.members'))
    CREATE INDEX idx_members_department ON dbo.members(department_id);
IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE parent_object_id = OBJECT_ID(N'dbo.members') AND name = N'UQ_members_user_id')
    ALTER TABLE dbo.members DROP CONSTRAINT UQ_members_user_id;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_members_user_id' AND object_id = OBJECT_ID(N'dbo.members'))
    CREATE UNIQUE INDEX idx_members_user_id ON dbo.members(user_id) WHERE user_id IS NOT NULL;
IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE parent_object_id = OBJECT_ID(N'dbo.members') AND name = N'UQ_members_student_id')
    ALTER TABLE dbo.members DROP CONSTRAINT UQ_members_student_id;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_members_student_id' AND object_id = OBJECT_ID(N'dbo.members'))
    CREATE UNIQUE INDEX idx_members_student_id ON dbo.members(student_id) WHERE student_id IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_media_uploaded_by' AND object_id = OBJECT_ID(N'dbo.media'))
    CREATE INDEX idx_media_uploaded_by ON dbo.media(uploaded_by);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_sponsors_logo_media' AND object_id = OBJECT_ID(N'dbo.sponsors'))
    CREATE INDEX idx_sponsors_logo_media ON dbo.sponsors(logo_media_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_revisions_content' AND object_id = OBJECT_ID(N'dbo.revisions'))
    CREATE INDEX idx_revisions_content ON dbo.revisions(content_type, content_id, created_at);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_revisions_editor' AND object_id = OBJECT_ID(N'dbo.revisions'))
    CREATE INDEX idx_revisions_editor ON dbo.revisions(editor_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_content_approvals_status' AND object_id = OBJECT_ID(N'dbo.content_approvals'))
    CREATE INDEX idx_content_approvals_status ON dbo.content_approvals(status, submitted_at);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_content_approvals_submitter' AND object_id = OBJECT_ID(N'dbo.content_approvals'))
    CREATE INDEX idx_content_approvals_submitter ON dbo.content_approvals(submitted_by);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_content_approvals_reviewer' AND object_id = OBJECT_ID(N'dbo.content_approvals'))
    CREATE INDEX idx_content_approvals_reviewer ON dbo.content_approvals(reviewer_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_content_approvals_one_pending_per_post' AND object_id = OBJECT_ID(N'dbo.content_approvals'))
    CREATE UNIQUE INDEX idx_content_approvals_one_pending_per_post ON dbo.content_approvals(post_id) WHERE status = N'pending';
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_audit_logs_created_at' AND object_id = OBJECT_ID(N'dbo.audit_logs'))
    CREATE INDEX idx_audit_logs_created_at ON dbo.audit_logs(created_at);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_audit_logs_actor' AND object_id = OBJECT_ID(N'dbo.audit_logs'))
    CREATE INDEX idx_audit_logs_actor ON dbo.audit_logs(actor_id, created_at);

IF NOT EXISTS (SELECT 1 FROM dbo.roles WHERE id = N'admin')
    INSERT INTO dbo.roles (id, name, description) VALUES (N'admin', N'Super Admin', N'Quản trị toàn bộ hệ thống và phân quyền.');
IF NOT EXISTS (SELECT 1 FROM dbo.roles WHERE id = N'chairperson')
    INSERT INTO dbo.roles (id, name, description) VALUES (N'chairperson', N'Chủ nhiệm', N'Quản lý nội dung và hoạt động, có thể duyệt nội dung.');
IF NOT EXISTS (SELECT 1 FROM dbo.roles WHERE id = N'department_head')
    INSERT INTO dbo.roles (id, name, description) VALUES (N'department_head', N'Trưởng/phó ban', N'Được đăng nội dung, cập nhật dự án; không được xóa dữ liệu, quản lý nhân sự hoặc cấu hình.');
IF NOT EXISTS (SELECT 1 FROM dbo.roles WHERE id = N'delegated_member')
    INSERT INTO dbo.roles (id, name, description) VALUES (N'delegated_member', N'Thành viên ủy quyền', N'Được thêm và chỉnh sửa nội dung; nội dung mới được đăng trực tiếp.');

UPDATE dbo.roles SET name = N'Trưởng/phó ban',
    description = N'Được đăng nội dung, cập nhật dự án; không được xóa dữ liệu, quản lý nhân sự hoặc cấu hình.'
WHERE id = N'department_head';
UPDATE dbo.roles SET name = N'Thành viên ủy quyền',
    description = N'Được thêm và chỉnh sửa nội dung; nội dung mới được đăng trực tiếp.'
WHERE id = N'delegated_member';

IF NOT EXISTS (SELECT 1 FROM dbo.permissions WHERE id = N'content.create')
    INSERT INTO dbo.permissions (id, name, description) VALUES (N'content.create', N'Tạo nội dung', N'Tạo bài viết, dự án hoặc hoạt động.');
IF NOT EXISTS (SELECT 1 FROM dbo.permissions WHERE id = N'content.edit')
    INSERT INTO dbo.permissions (id, name, description) VALUES (N'content.edit', N'Chỉnh sửa nội dung', N'Chỉnh sửa nội dung được phép quản lý.');
IF NOT EXISTS (SELECT 1 FROM dbo.permissions WHERE id = N'content.approve')
    INSERT INTO dbo.permissions (id, name, description) VALUES (N'content.approve', N'Đăng nội dung trực tiếp', N'Đăng bài viết và hoạt động mới ngay trên trang chủ.');
IF NOT EXISTS (SELECT 1 FROM dbo.permissions WHERE id = N'content.delete')
    INSERT INTO dbo.permissions (id, name, description) VALUES (N'content.delete', N'Xóa nội dung', N'Xóa nội dung.');
IF NOT EXISTS (SELECT 1 FROM dbo.permissions WHERE id = N'members.manage')
    INSERT INTO dbo.permissions (id, name, description) VALUES (N'members.manage', N'Quản lý thành viên', N'Quản lý hồ sơ thành viên.');
IF NOT EXISTS (SELECT 1 FROM dbo.permissions WHERE id = N'users.manage')
    INSERT INTO dbo.permissions (id, name, description) VALUES (N'users.manage', N'Quản lý tài khoản', N'Cấp quyền và quản lý tài khoản.');
IF NOT EXISTS (SELECT 1 FROM dbo.permissions WHERE id = N'settings.manage')
    INSERT INTO dbo.permissions (id, name, description) VALUES (N'settings.manage', N'Quản lý cấu hình', N'Thay đổi cấu hình hệ thống.');

UPDATE dbo.permissions SET name = N'Đăng nội dung trực tiếp',
    description = N'Đăng bài viết và hoạt động mới ngay trên trang chủ.'
WHERE id = N'content.approve';

INSERT INTO dbo.role_permissions (role_id, permission_id)
SELECT N'admin', id FROM dbo.permissions
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.role_permissions WHERE role_id = N'admin' AND permission_id = dbo.permissions.id
);
INSERT INTO dbo.role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM (VALUES
    (N'chairperson', N'content.create'),
    (N'chairperson', N'content.edit'),
    (N'chairperson', N'content.approve'),
    (N'chairperson', N'members.manage'),
    (N'department_head', N'content.create'),
    (N'department_head', N'content.edit'),
    (N'department_head', N'content.approve'),
    (N'delegated_member', N'content.create'),
    (N'delegated_member', N'content.edit')
) AS defaults(role_id, permission_id)
JOIN dbo.roles ON dbo.roles.id = defaults.role_id
JOIN dbo.permissions ON dbo.permissions.id = defaults.permission_id
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.role_permissions
    WHERE role_id = defaults.role_id AND permission_id = defaults.permission_id
);
INSERT INTO dbo.role_permissions (role_id, permission_id)
SELECT roles.id, N'content.approve'
FROM dbo.roles
WHERE roles.id IN (N'admin', N'chairperson', N'department_head', N'delegated_member')
AND NOT EXISTS (
    SELECT 1 FROM dbo.role_permissions
    WHERE role_id = roles.id AND permission_id = N'content.approve'
);
