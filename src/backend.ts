//import your providers here (providers only run in the backend)
import './utils/BackendProvider.js';
import './utils/ShapeProvider.js';
import './utils/Upload.js';
import { BackendProvider } from './utils/BackendProvider.js';
import { relativeFileSystemUploadPath } from './utils/Upload.js';
import fs from 'fs';
import path from 'path';
import { LinkedFileStorage } from '@_linked/core/utils/LinkedFileStorage';
import {
  UpdateMessage,
  updates,
  LinkedLiveUpdate,
} from './utils/LinkedLiveUpdates.js';
import cluster from 'cluster';
import { Server } from './utils/Server.js';
import { declareCallable } from './utils/callable.js';
import { requireSessionUser } from './utils/CallContext.js';

const MAX_BROADCAST_TIME: number = 15 * 60 * 1_000; //15 minutes in ms
let lastBroadcastTime: number = Date.now();
const MAX_UPDATES_PER_CALL = 100;

export class LincdServerUtilsBackendProvider extends BackendProvider {
  setupBeforeControllers() {
    this.setupLiveUpdatesMulticore();

    // No need to continue to run local file-system based checks
    // if we're using a CDN or a different service to deliver assets
    if (LinkedFileStorage.accessURL !== process.env.SITE_ROOT) {
      return;
    }

    //check if folder data/uploads exists
    if (!fs.existsSync(relativeFileSystemUploadPath)) {
      fs.mkdirSync(relativeFileSystemUploadPath, { recursive: true });
    }
    let resizedImagesCachePath = path.join(
      relativeFileSystemUploadPath,
      'resized'
    );
    if (!fs.existsSync(resizedImagesCachePath)) {
      fs.mkdirSync(resizedImagesCachePath, { recursive: true });
    }
    // for(let i = 0; i < 1; i++)
    // {
    //   LinkedLiveUpdate.send('activity',{
    //     countryCode: 'us',
    //     message: `pid ${process.pid}`,
    //   });
    // }
  }

  setupLiveUpdatesMulticore() {
    if (cluster.isWorker) {
      //automatically set up the LinkedLiveUpdate class to sync between cores if we're in a worker

      //send messages
      setInterval(() => {
        const lincdServer = Server.getLocalServer();
        const currentTime = Date.now();

        if (lincdServer) {
          const serverIsBusy = lincdServer?.busy as boolean;
          if (
            serverIsBusy &&
            currentTime - lastBroadcastTime < MAX_BROADCAST_TIME
          ) {
            // this.log('Worker is busy, skipping broadcast of queued live updates');
            return;
          }
        }

        if (LinkedLiveUpdate.batchedUpdates.length > 0) {
          // console.log(
          //   `${process.pid} sending ${LinkedLiveUpdate.batchedUpdates.length} updates to primary`,
          // );
          process.send({
            cmd: 'liveUpdates',
            updates: LinkedLiveUpdate.batchedUpdates,
            sender: process.pid,
          });
          LinkedLiveUpdate.batchedUpdates = [];
          lastBroadcastTime = currentTime;
        }
      }, 10_000); // send updates every second

      //process incoming messages
      process.on('message', (primaryMsg: any) => {
        if (primaryMsg.cmd === 'batch') {
          primaryMsg.messages.forEach((workerMsg: any) => {
            if (workerMsg.sender === process.pid) {
              // console.log(`${workerMsg.cmd} ignored own message`);
              return;
            }
            if (workerMsg.cmd === 'liveUpdates') {
              workerMsg.updates.forEach((msg) => {
                updates.push(msg);
              });
              // console.log(
              //   `${process.pid} received ${workerMsg.updates.length} updates from worker ${workerMsg.sender}`,
              // );
              // console.log(`${process.pid} messages now: ${updates.map((u) => u.data.message).join(', ')}`);
            }
          });
        }
      });
    }
  }

  /**
   * The live updates since `timestamp` that the signed-in caller may see: the
   * broadcast ones, and those sent to this caller's account. Requires a session.
   */
  getUpdatesSince(timestamp: number, limit: number = 10): UpdateMessage[] {
    const userAccount = requireSessionUser();
    const userId =
      typeof userAccount === 'string' ? userAccount : userAccount?.id;
    const since = Number.isFinite(Number(timestamp)) ? Number(timestamp) : 0;
    let max = Math.floor(Number(limit));
    if (!Number.isFinite(max) || max <= 0 || max > MAX_UPDATES_PER_CALL) {
      max = MAX_UPDATES_PER_CALL;
    }
    const filtered = updates.filter(
      (update) =>
        update.timestamp > since &&
        (update.to === undefined || (userId !== undefined && update.to === userId))
    );
    // the most recent messages
    return filtered.slice(-max);
  }
}

declareCallable(LincdServerUtilsBackendProvider, {
  getUpdatesSince: 'user',
});
