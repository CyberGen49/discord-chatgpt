CREATE TABLE IF NOT EXISTS "messages" (
	"time_created"	INTEGER NOT NULL,
	"user_id"	INTEGER NOT NULL,
	"channel_id"	INTEGER NOT NULL,
	"message_id"	INTEGER NOT NULL UNIQUE,
	"input"	TEXT NOT NULL,
	"output"	TEXT NOT NULL,
	"count_tokens"	INTEGER NOT NULL
);
