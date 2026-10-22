import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { Mastra } from '@mastra/core/mastra';
import { PostgresStore } from '@mastra/pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const storage = new PostgresStore({
  id: 'migration-check',
  connectionString: process.env.DATABASE_URL,
  schemaName: 'mastra',
});
const attachment = '11111111-1111-4111-8111-111111111111';
const task = '22222222-2222-4222-8222-222222222222';
const schedule = '33333333-3333-4333-8333-333333333333';
await storage.init();
try {
  const memory = await storage.getStore('memory');
  const schedules = await storage.getStore('schedules');
  if (process.env.MIGRATION_PHASE === 'seed') {
    await pool.query(
      "insert into tasks (id,title,goal) values ($1,'Existing task','Read /data/workspace/report.txt')",
      [task],
    );
    await pool.query(
      "insert into attachments (id,filename,content_type,size_bytes,storage_filename) values ($1,'old.txt','text/plain',20,$2)",
      [attachment, attachment + '.txt'],
    );
    const message = await pool.query(
      "insert into messages (role,text) values ('assistant','Historical /data/uploads/' || $1 || '.txt') returning id",
      [attachment],
    );
    await pool.query(
      'insert into message_attachments (message_id,attachment_id,position) values ($1,$2,0)',
      [message.rows[0].id, attachment],
    );
    const now = new Date();
    await memory.saveThread({
      thread: {
        id: 'pal-task:' + task,
        resourceId: 'pal-owner',
        title: 'Existing task',
        createdAt: now,
        updatedAt: now,
      },
    });
    await memory.saveMessages({
      messages: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          threadId: 'pal-task:' + task,
          resourceId: 'pal-owner',
          role: 'user',
          createdAt: now,
          content: {
            format: 2,
            parts: [
              {
                type: 'text',
                text: 'Read /data/workspace/report.txt and /data/home/notes.txt',
              },
            ],
          },
        },
      ],
    });
    await schedules.createSchedule({
      id: schedule,
      cron: '0 9 * * *',
      status: 'paused',
      timezone: 'America/Los_Angeles',
      target: {
        type: 'agent',
        agentId: 'pal-task-agent',
        threadId: 'pal-task:' + task,
        resourceId: 'pal-owner',
        prompt: 'Read /data/workspace/report.txt',
      },
      nextFireAt: Date.now() + 86400000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ownerType: 'agent',
      ownerId: 'pal-task-agent',
    });
  } else {
    assert.equal(
      (await pool.query('select title from tasks where id=$1', [task])).rows[0]
        .title,
      'Existing task',
    );
    assert.equal(
      (await pool.query('select count(*) from message_attachments')).rows[0]
        .count,
      '1',
    );
    const messages = await memory.listMessages({
      threadId: 'pal-task:' + task,
      perPage: false,
    });
    assert.match(JSON.stringify(messages.messages), /\/data\/home\/notes.txt/);
    const saved = await schedules.getSchedule(schedule);
    assert.equal(saved.status, 'paused');
    const native = await new Mastra({ storage }).schedules.list({
      agentId: 'pal-task-agent',
      resourceId: 'pal-owner',
      threadId: 'pal-task:' + task,
    });
    assert.equal(native[0]?.id, schedule);
    assert.match(saved.target.prompt, /\/data\/workspace\/report.txt/);
    console.log(
      'PASS: conversations, attachments, native memory, and schedule retained',
    );
  }
} finally {
  await storage.close();
  await pool.end();
}
