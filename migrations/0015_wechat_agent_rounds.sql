-- Encrypted model decisions form a write-ahead journal for ReAct.
-- Existing wechat_tool_steps and wechat_messages remain the commit/reply journal.
-- A replay MUST reuse the original decisions before executing any step.
CREATE TABLE IF NOT EXISTS wechat_agent_rounds (
 message_id TEXT NOT NULL,
 round_index INTEGER NOT NULL CHECK(round_index>=0 AND round_index<32),
 assistant_cipher TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(message_id,round_index)
);
CREATE INDEX IF NOT EXISTS wechat_agent_rounds_created ON wechat_agent_rounds(created_at);
