export class SaveDeletedError extends Error {
  constructor(message) {
    super(message);
    this.name = "SavedDeletedError";
  }
}
