// export interface ILiveUpdater {
//   getUpdatesSince(timestamp: number): {type:string,data:any}[];
//   send(type: string, data: any): void;
// }
//
// /**
//  * Utility class to send live updates from the backend to the frontend.
//  * Install any error client package like lincd-sentry in your app to log errors.
//  */
// export class LinkedLiveUpdates {
//   private static updater: ILiveUpdater;
//
//   static setDefaultLogger(updater: ILiveUpdater) {
//     this.updater = updater;
//   }
//
//   static hasDefaultUpdater() {
//     return this.updater && true;
//   }
//   static send(type: string, data: any):void {
//     return this.updater.send(type, data);
//   }
//   static getUpdatesSince(timestamp: number): {type:string,data:any}[] {
//     return this.updater.getUpdatesSince(timestamp);
//   }
// }
//
import { Server } from './Server.js';
import { packageName } from '../package.js';

export interface UpdateMessage {
  timestamp: number;
  type: string;
  data: any;
  /**
   * The id of the only user account that may receive this update. Without it
   * the update is a broadcast to every signed-in user.
   */
  to?: string;
}
export const updates: UpdateMessage[] = [];
export class LinkedLiveUpdate {
  static batchedUpdates: UpdateMessage[] = [];

  /**
   * To be used on the backend to send updates to the frontend.
   * Every signed-in user receives the update, unless `options.to` names the one
   * user account (by id) that should.
   * @param type
   * @param data
   * @param options
   */
  public static send(
    type: string,
    data: any,
    options?: { to?: string }
  ): void {
    //on the backend we store the updates in memory in an exported variable called updates
    const newMessage: UpdateMessage = {
      timestamp: Date.now(),
      type,
      data,
    };
    if (options?.to) {
      newMessage.to = options.to;
    }
    updates.push(newMessage);

    //for multicore environments, we batch updates to avoid sending too many messages
    this.batchedUpdates.push(newMessage);
  }

  /**
   * To be used on the frontend to get the latest updates from the backend.
   * Requires a signed-in user; returns at most 100 updates.
   * @param timestamp
   */
  public static getUpdatesSince(
    timestamp: number = Date.now(),
    limit: number = 10
  ): Promise<UpdateMessage[]> {
    // see backend.ts in this package for implementation
    return Server.call(packageName, 'getUpdatesSince', timestamp, limit);
  }
}
