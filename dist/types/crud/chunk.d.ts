/**
 * Most values bound into one `WHERE column IN (...)` list.
 *
 * Every value is a bound parameter, and both databases cap parameters per statement: SQLite at
 * 32,766, Postgres at 65,535. A list built from user data (eager loading 70k parents, cascading
 * a delete through 40k children, detaching thousands of targets) went past those caps before
 * 0.1.7 and failed. Lists are now split into chunks of this size, leaving plenty of room for the
 * statement's other bindings.
 */
export declare const IN_LIST_CHUNK = 5000;
