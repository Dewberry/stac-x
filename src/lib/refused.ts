/**
 * A save or a promotion this app turned down, with the reason in words
 * written for the person at the screen: a date in the wrong form, a file
 * that holds two collections, a review record that can't be read.
 *
 * The server action shows a Refused message as it is. Anything else that
 * goes wrong while saving is S3's or the disk's own text, which can name
 * the account, the role or a path on the server, so it goes to the log and
 * the person is told to look there.
 */
export class Refused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Refused";
  }
}
