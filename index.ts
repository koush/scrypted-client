import { EventListener, ScryptedStatic, SystemManager, ScryptedDevice, EventDetails, EventListenerRegister, ScryptedDeviceType, EventListenerOptions, ScryptedInterfaceDescriptors, MediaManager, MediaObject, FFMpegInput } from "@scrypted/sdk";
import { Socket, SocketOptions } from 'engine.io-client';
const Client = require('engine.io-client');
import axios from 'axios';

const allMethods: any[] = [].concat(... Object.values(ScryptedInterfaceDescriptors).map((type: any) => type.methods));
const allProperties: any[] = [].concat(... Object.values(ScryptedInterfaceDescriptors).map((type: any) => type.properties));

class ScryptedDeviceImpl implements ProxyHandler<object>, ScryptedDevice {
    session: ClientSession;
    constructor(session: ClientSession, id: string) {
        this.session = session;
        this.id = id;
    }

    setRoom(arg0: string): void {
        throw new Error("Method not implemented.");
    }

    listen(event: string | EventListenerOptions, callback: (eventSource: ScryptedDevice | null, eventDetails: EventDetails, eventData: object) => void): EventListenerRegister {
        throw new Error("Method not implemented.");
    }

    setName(name: string): void {
        throw new Error("Method not implemented.");
    }
    setType(type: ScryptedDeviceType): void {
        throw new Error("Method not implemented.");
    }
    id: string;

    get? (target: any, property: PropertyKey, receiver: any): any {
        const state = this.session.systemState[this.id];
        if (!state) {
            return undefined;
        }

        switch (property) {
            case "id":
                return this.id;
            case "interfaces":
            case "id":
            case "room":
            case "name":
            case "type":
            case "component":
            case "metadata":
                return state[property] && state[property].value;
        }

        if (allProperties.includes(property)) {
            const found = state[property];
            if (!found) {
                return undefined;
            }
            return found ? found.value : undefined;
        }

        if (!allMethods.includes(property)) {
            return undefined;
        }

        const interfaces: string[] = state.interfaces && state.interfaces.value;
        if (!interfaces) {
            return undefined;
        }

        const interfaceMethods: any[] = [].concat(... Object.values(ScryptedInterfaceDescriptors)
            .filter((type: any) => interfaces.includes(type.name))
            .map((type: any) => type.methods));

        if (!interfaceMethods.includes(property)) {
            return (this as any)[property];
        }

        return new Proxy(() => property, this);
    }

    apply? (target: any, thisArg: any, argArray?: any): any {
        if (target() == 'getVideoStream') {
            return {
                id: this.id,
                method: target(),
            };
        }
        this.session.send({
            type: 'method',
            id: this.id,
            method: target(),
            argArray,
        })
    }
}

class SystemManagerImpl implements SystemManager {
    session: ClientSession;

    constructor(session: ClientSession) {
        this.session = session;
    }
    getDeviceById(id: string): ScryptedDevice | null {
        const ret = this.session.systemState[id];
        if (!ret) {
            return null;
        }

        const device = new ScryptedDeviceImpl(this.session, id);
        return new Proxy(device, device);
    }
    getDeviceByName(name: string): ScryptedDevice | null {
        return null;
    }
    getDeviceState(id: string): object {
        throw new Error("Method not implemented.");
    }
    getSystemState(): object {
        // note: sending back reference is potentially wonky. but this allows
        // vue to turn this into a observable object.
        return this.session.systemState;
    }
    getInstalledPackages(): Promise<object> {
        const resultId = Math.random().toString();
        this.session.send({
            resultId,
            type: 'system',
            method: 'getInstalledPackages',
        });
        return this.session.newPendingResult(resultId);
    }
    listeners: any = {};
    listen(callback: (eventSource: ScryptedDevice | null, eventDetails: EventDetails, eventData: object) => void): EventListenerRegister {
        var listenerId = Math.random().toString();
        this.listeners[listenerId] = callback;
        const removeListener = () => delete this.listeners[listenerId];
        return {
            removeListener,
        }
    }
    handleIncomingMessage(message: any) {
        switch (message.type) {
            case 'sync': {
                const { id, eventDetails, eventData }: {id: string, eventDetails: EventDetails, eventData: any} = message;
                if (!eventDetails.property) {
                    return;
                }
                const device = this.session.systemState[id] = this.session.systemState[id] || {};
                var state = device[eventDetails.property] = device[eventDetails.property] || {};
                state = Object.assign(state, {
                    stateTime: state.value !== eventData ? eventDetails.eventTime : state.lastEventTime,
                    lastEventTime: eventDetails.eventTime,
                    sourceInterface: eventDetails.eventInterface,
                    value: eventData,
                });
                for (var listener of Object.values(this.listeners)) {
                    try {
                        (listener as any)(this.getDeviceById(id), eventDetails, eventData);
                    }
                    catch (e) {
                        console.error('scrypted client: error in listener', e);
                    }
                }

                if (eventDetails.property === 'id' && !eventData) {
                    delete this.session.systemState[id];
                }
                break;
            }
            case 'system': {
                const { resultId, error, result } = message;
                this.session.resolvePendingResult(resultId, result, error);
                break;
            }
        }
    }
}

class MediaManagerImpl implements MediaManager {
    session: ClientSession;

    constructor(session: ClientSession) {
        this.session = session;
    }
    convertMediaObjectToBuffer(mediaSource: MediaObject, toMimeType: string): Promise<Buffer> {
        const resultId = Math.random().toString();
        this.session.send({
            type: 'media',
            method: 'convertMediaObjectToBuffer',
            toMimeType,
            mediaSource,
            resultId,
        })
        return this.session.newPendingResult(resultId)
        .then(base64 => Buffer.from(base64, 'base64'));
    }
    _convertMediaObjectToUri(method: string, mediaSource: MediaObject, toMimeType: string): Promise<string> {
        const resultId = Math.random().toString();
        this.session.send({
            type: 'media',
            method,
            toMimeType,
            mediaSource,
            resultId,
        })
        return this.session.newPendingResult(resultId);
    }
    convertMediaObjectToUri(mediaSource: MediaObject, toMimeType: string): Promise<string> {
        return this._convertMediaObjectToUri('convertMediaObjectToUri', mediaSource, toMimeType);
    }
    convertMediaObjectToLocalUri(mediaSource: MediaObject, toMimeType: string): Promise<string> {
        return this._convertMediaObjectToUri('convertMediaObjectToLocalUri', mediaSource, toMimeType);
    }
    createFFmpegMediaObject(ffMpegInput: FFMpegInput): MediaObject {
        throw new Error("Method not implemented.");
    }
    createMediaObject(data: string | Buffer | Promise<string | Buffer>, mimeType: string): MediaObject {
        throw new Error("Method not implemented.");
    }
    handleIncomingMessage(message: any) {
        switch (message.type) {
            case 'media': {
                const { resultId, error, result } = message;
                this.session.resolvePendingResult(resultId, result, error);
                break;
            }
        }
    }
}

export interface ScryptedClientStatic extends ScryptedStatic {
    disconnect(): void;
}

class ClientSession {
    apiUrl: string;
    systemState: any;
    socket: Socket;
    pendingResults: any = {};

    send(data: any) {
        this.socket.send(JSON.stringify(data));
    }

    constructor(socket: Socket, apiUrl: string, systemState: any) {
        this.socket = socket;
        this.apiUrl = apiUrl;
        this.systemState = systemState;
    }

    newPendingResult(resultId: string): Promise<any> {
        var result: any = this.pendingResults[resultId] = {};
        return new Promise<string>((resolve, reject) => {
            result.resolve = resolve;
            result.reject = reject;
        })
    }
    resolvePendingResult(resultId: string, result: any, error: any) {
        const promise = this.pendingResults[resultId];
        delete this.pendingResults[resultId];
        if (!promise) {
            return;
        }
        if (result) {
            promise.resolve(result);
        }
        else {
            promise.reject(new Error(error));
        }
    }
}

export default {
    connect(baseUrl: string): Promise<ScryptedClientStatic> {
        const rootLocation = baseUrl || `${window.location.protocol}//${window.location.host}`;
        const endpointPath = `/endpoint/@scrypted/ui`;
        const endpointUrl = `${rootLocation}${endpointPath}`;
        const apiUrl = `${endpointUrl}/api`;

        return new Promise((resolve, reject) => {

            const options: SocketOptions = {
                path: `${endpointPath}/engine.io/`,
            };
            const socket = new Client(rootLocation, options);

            socket.on('open', async function() {
                try {
                    var { data: systemState } = await axios(`${apiUrl}/state`);

                    const session = new ClientSession(socket, apiUrl, systemState);
                    const systemManager = new SystemManagerImpl(session);
                    const mediaManager = new MediaManagerImpl(session);

                    socket.on('message', (message: any) => {
                        // console.log(message);
                        systemManager.handleIncomingMessage(JSON.parse(message))
                        mediaManager.handleIncomingMessage(JSON.parse(message))
                    });

                    resolve({
                        systemManager,
                        mediaManager,
                        disconnect: socket.close.bind(socket),
                    });
                }
                catch (e) {
                    socket.close();
                    reject(e);
                }
            })
        });
    }
}
