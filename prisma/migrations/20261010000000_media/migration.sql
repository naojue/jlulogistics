CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileId" TEXT NOT NULL,
    "resourceId" TEXT,
    "postId" TEXT,
    "commentId" TEXT,
    "replyId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Attachment_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Attachment_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Attachment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Attachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "ResourceComment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Attachment_replyId_fkey" FOREIGN KEY ("replyId") REFERENCES "PostReply" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Attachment_one_parent" CHECK (("resourceId" IS NOT NULL) + ("postId" IS NOT NULL) + ("commentId" IS NOT NULL) + ("replyId" IS NOT NULL) = 1)
);
CREATE UNIQUE INDEX "Attachment_fileId_key" ON "Attachment"("fileId");
CREATE INDEX "Attachment_resourceId_position_idx" ON "Attachment"("resourceId", "position");
CREATE INDEX "Attachment_postId_position_idx" ON "Attachment"("postId", "position");
CREATE INDEX "Attachment_commentId_position_idx" ON "Attachment"("commentId", "position");
CREATE INDEX "Attachment_replyId_position_idx" ON "Attachment"("replyId", "position");
