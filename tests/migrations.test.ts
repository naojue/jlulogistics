import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
it("新迁移保留旧账号与主文件，附件在数据库中只能关联一个父内容", () => {
  const connection = new Database(":memory:");
  try {
    connection.pragma("foreign_keys = ON");
    connection.exec(readFileSync("prisma/migrations/20260928000000_init/migration.sql", "utf8"));
    connection.exec(`INSERT INTO "User" (id,name,email,emailVerified,status,updatedAt) VALUES ('old-user','原有成员','old@example.test',1,'ACTIVE',CURRENT_TIMESTAMP);
      INSERT INTO "Category" VALUES ('category','资料分类','RESOURCE');
      INSERT INTO "StoredFile" (id,key,name,mime,size) VALUES ('old-file','old-key','原有讲义.pdf','application/pdf',100);
      INSERT INTO "Resource" (id,title,description,area,categoryId,authorId,fileId,updatedAt) VALUES ('old-resource','原有资料','原有资料介绍','MEMBER','category','old-user','old-file',CURRENT_TIMESTAMP);`);
    const before = connection.prepare('SELECT * FROM "Resource"').get();
    connection.exec(readFileSync("prisma/migrations/20261010000000_media/migration.sql", "utf8"));
    expect(connection.prepare('SELECT * FROM "Resource"').get()).toEqual(before);
    expect(connection.prepare('SELECT status FROM "User"').get()).toEqual({ status: "ACTIVE" });
    connection.exec(
      `INSERT INTO "StoredFile" (id,key,name,mime,size) VALUES ('new-file','new-key','新图片.png','image/png',10)`,
    );
    expect(() =>
      connection.exec(`INSERT INTO "Attachment" (id,fileId) VALUES ('empty','new-file')`),
    ).toThrow("CHECK");
    expect(() =>
      connection.exec(
        `INSERT INTO "Attachment" (id,fileId,resourceId,postId) VALUES ('both','new-file','old-resource','nonexistent')`,
      ),
    ).toThrow("CHECK");
    connection.exec(
      `INSERT INTO "Attachment" (id,fileId,resourceId) VALUES ('valid','new-file','old-resource')`,
    );
    expect(connection.prepare('SELECT count(*) AS count FROM "Attachment"').get()).toEqual({
      count: 1,
    });
  } finally {
    connection.close();
  }
});
it("项目与页码迁移保留旧资料、旧评论、旧附件，并限制同时更新与版本边界", () => {
  const connection = new Database(":memory:");
  try {
    connection.pragma("foreign_keys = ON");
    connection.exec(readFileSync("prisma/migrations/20260928000000_init/migration.sql", "utf8"));
    connection.exec(readFileSync("prisma/migrations/20261010000000_media/migration.sql", "utf8"));
    connection.exec(`INSERT INTO "User" (id,name,email,emailVerified,status,updatedAt) VALUES ('u','旧成员','u@example.test',1,'ACTIVE',CURRENT_TIMESTAMP);
      INSERT INTO "Category" VALUES ('c','资料','RESOURCE');
      INSERT INTO "StoredFile" (id,key,name,mime,size) VALUES ('f','key','讲义.pdf','application/pdf',100);
      INSERT INTO "Resource" (id,title,description,area,categoryId,authorId,fileId,updatedAt) VALUES ('r','讲义','旧介绍','MEMBER','c','u','f',CURRENT_TIMESTAMP);
      INSERT INTO "ResourceComment" (id,body,authorId,resourceId,updatedAt) VALUES ('old-comment','旧评论','u','r',CURRENT_TIMESTAMP);`);
    const before = connection.prepare('SELECT * FROM "Resource"').get();
    connection.exec(
      readFileSync("prisma/migrations/20261011000000_projects_questions/migration.sql", "utf8"),
    );
    expect(connection.prepare('SELECT * FROM "Resource"').get()).toEqual(before);
    expect(
      connection.prepare('SELECT body,pdfFileId,pdfPage,resolvedAt FROM "ResourceComment"').get(),
    ).toEqual({ body: "旧评论", pdfFileId: null, pdfPage: null, resolvedAt: null });
    connection.exec(`INSERT INTO "Project" (id,title,description,course,authorId,updatedAt) VALUES ('p','项目','介绍','课程','u',CURRENT_TIMESTAMP);
      INSERT INTO "ProjectSyncTask" (id,requestId,projectId,actorId,versionMessage,expiresAt,updatedAt) VALUES ('t','request','p','u','首版',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);`);
    expect(() =>
      connection.exec(
        `INSERT INTO "ProjectSyncTask" (id,requestId,projectId,actorId,versionMessage,expiresAt,updatedAt) VALUES ('t2','request2','p','u','二版',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      ),
    ).toThrow("UNIQUE");
    expect(() =>
      connection.exec(
        `INSERT INTO "ProjectVersion" (id,projectId,taskId,number,message,commitSha,fileCount,size) VALUES ('v','p','t',1,'版本','sha',1,209715201)`,
      ),
    ).toThrow("CHECK");
  } finally {
    connection.close();
  }
});
