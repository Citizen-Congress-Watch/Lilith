-- Ensure committees are unique per term + session + name
CREATE UNIQUE INDEX "Committee_term_session_name_key" ON "Committee"("term", "session", "name");

