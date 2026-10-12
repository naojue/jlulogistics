ALTER TABLE "ResourceComment" ADD COLUMN "pdfFileId" TEXT;
ALTER TABLE "ResourceComment" ADD COLUMN "pdfPage" INTEGER;
ALTER TABLE "ResourceComment" ADD COLUMN "resolvedAt" DATETIME;
CREATE INDEX "ResourceComment_resourceId_pdfFileId_parentId_deletedAt_createdAt_idx" ON "ResourceComment"("resourceId", "pdfFileId", "parentId", "deletedAt", "createdAt");

CREATE TABLE "Project" (
  "id" TEXT NOT NULL PRIMARY KEY, "title" TEXT NOT NULL, "description" TEXT NOT NULL,
  "course" TEXT NOT NULL, "tags" TEXT NOT NULL DEFAULT '', "authorId" TEXT NOT NULL,
  "repositoryName" TEXT, "currentVersionId" TEXT, "deletedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("currentVersionId") REFERENCES "ProjectVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Project_repositoryName_key" ON "Project"("repositoryName");
CREATE UNIQUE INDEX "Project_currentVersionId_key" ON "Project"("currentVersionId");
CREATE INDEX "Project_deletedAt_createdAt_idx" ON "Project"("deletedAt", "createdAt");
CREATE INDEX "Project_authorId_deletedAt_updatedAt_idx" ON "Project"("authorId", "deletedAt", "updatedAt");

CREATE TABLE "ProjectVersion" (
  "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "taskId" TEXT NOT NULL,
  "number" INTEGER NOT NULL, "message" TEXT NOT NULL, "commitSha" TEXT NOT NULL,
  "fileCount" INTEGER NOT NULL, "size" INTEGER NOT NULL, "filesJson" TEXT NOT NULL DEFAULT '[]',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK ("number" > 0 AND "size" >= 0 AND "size" <= 209715200 AND "fileCount" > 0 AND "fileCount" <= 1000)
);
CREATE UNIQUE INDEX "ProjectVersion_taskId_key" ON "ProjectVersion"("taskId");
CREATE UNIQUE INDEX "ProjectVersion_projectId_number_key" ON "ProjectVersion"("projectId", "number");
CREATE UNIQUE INDEX "ProjectVersion_projectId_commitSha_key" ON "ProjectVersion"("projectId", "commitSha");

CREATE TABLE "ProjectSyncTask" (
  "id" TEXT NOT NULL PRIMARY KEY, "requestId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL, "uploadKey" TEXT, "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "error" TEXT, "versionMessage" TEXT NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0,
  "cleanedAt" DATETIME, "expiresAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK ("status" IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED'))
);
CREATE UNIQUE INDEX "ProjectSyncTask_requestId_key" ON "ProjectSyncTask"("requestId");
CREATE UNIQUE INDEX "ProjectSyncTask_one_active_per_project" ON "ProjectSyncTask"("projectId") WHERE "status" IN ('QUEUED', 'RUNNING');
CREATE INDEX "ProjectSyncTask_status_createdAt_idx" ON "ProjectSyncTask"("status", "createdAt");
CREATE INDEX "ProjectSyncTask_projectId_createdAt_idx" ON "ProjectSyncTask"("projectId", "createdAt");

CREATE TABLE "ProjectWorkerLease" (
  "id" TEXT NOT NULL PRIMARY KEY, "token" TEXT NOT NULL, "expiresAt" DATETIME NOT NULL
);
CREATE TABLE "ProjectComment" (
  "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "authorId" TEXT NOT NULL,
  "body" TEXT NOT NULL, "parentId" TEXT, "deletedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("parentId") REFERENCES "ProjectComment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ProjectComment_projectId_deletedAt_createdAt_idx" ON "ProjectComment"("projectId", "deletedAt", "createdAt");
CREATE TABLE "ProjectCommentAttachment" (
  "id" TEXT NOT NULL PRIMARY KEY, "commentId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL, "position" INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY ("commentId") REFERENCES "ProjectComment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProjectCommentAttachment_fileId_key" ON "ProjectCommentAttachment"("fileId");
CREATE INDEX "ProjectCommentAttachment_commentId_position_idx" ON "ProjectCommentAttachment"("commentId", "position");
