CREATE TABLE IF NOT EXISTS "messages" (
	"time_created"	INTEGER NOT NULL,
	"user_id"	TEXT NOT NULL,
	"channel_id"	TEXT NOT NULL,
	"input_msg_id"	TEXT NOT NULL UNIQUE,
	"output_msg_id"	TEXT,
	"input"	TEXT NOT NULL,
	"output"	TEXT NOT NULL,
	"messages"	TEXT NOT NULL,
	"count_tokens"	INTEGER NOT NULL
);