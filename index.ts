import { EventListener, ScryptedStatic, SystemManager, ScryptedDevice, EventDetails, EventListenerRegister, ScryptedDeviceType, EventListenerOptions, ScryptedInterfaceDescriptors, MediaManager, MediaObject, FFMpegInput } from "@scrypted/sdk";
import { Socket, SocketOptions } from 'engine.io-client';
const Client = require('engine.io-client');
import axios from 'axios';
const cloneDeep = require('lodash.clonedeep');

const allMethods: any[] = [].concat(... Object.values(ScryptedInterfaceDescriptors).map((type: any) => type.methods));
const allProperties: any[] = [].concat(... Object.values(ScryptedInterfaceDescriptors).map((type: any) => type.properties));

class ScryptedDeviceImpl implements ProxyHandler<object>, ScryptedDevice {
    setRoom(arg0: string): void {
        throw new Error("Method not implemented.");
    }
    systemManager: SystemManagerImpl;
    constructor(systemManager: SystemManagerImpl, id: string) {
        this.systemManager = systemManager;
        this.id = id;
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
        const state = this.systemManager.systemState[this.id];
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
                return state[property].value;
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
        this.systemManager.send({
            type: 'method',
            id: this.id,
            method: target(),
            argArray,
        })
    }
}

class SystemManagerImpl implements SystemManager {
    apiUrl: string;
    systemState: any = {};
    socket: Socket;

    constructor(socket: Socket, apiUrl: string, systemState: any) {
        this.socket = socket;
        this.apiUrl = apiUrl;
        this.systemState = systemState;
    }
    getDeviceById(id: string): ScryptedDevice | null {
        const ret = this.systemState[id];
        if (!ret) {
            return null;
        }

        const device = new ScryptedDeviceImpl(this, id);
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
        return this.systemState;
    }
    send(data: any) {
        this.socket.send(JSON.stringify(data));
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
                const device = this.systemState[message.id] = this.systemState[message.id] || {};
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
                break;
            }
        }
    }
}

class MediaManagerImpl implements MediaManager {
    apiUrl: string;
    systemState: any = {};
    socket: Socket;

    constructor(socket: Socket, apiUrl: string, systemState: any) {
        this.socket = socket;
        this.apiUrl = apiUrl;
        this.systemState = systemState;
    }
    results: any = {};
    convertMediaObjectToBuffer(mediaSource: MediaObject, toMimeType: string): Promise<Buffer> {
        const resultId = Math.random().toString();
        this.send({
            type: 'media',
            method: 'convertMediaObjectToBuffer',
            toMimeType,
            mediaSource,
            resultId,
        })
        var result: any = this.results[resultId] = {};
        return new Promise<string>((resolve, reject) => {
            result.resolve = resolve;
            result.reject = reject;
        })
        .then(base64 => Buffer.from(base64, 'base64'));
    }
    _convertMediaObjectToUri(method: string, mediaSource: MediaObject, toMimeType: string): Promise<string> {
        const resultId = Math.random().toString();
        this.send({
            type: 'media',
            method,
            toMimeType,
            mediaSource,
            resultId,
        })
        var result: any = this.results[resultId] = {};
        return new Promise<string>((resolve, reject) => {
            result.resolve = resolve;
            result.reject = reject;
        })
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
    send(data: any) {
        this.socket.send(JSON.stringify(data));
    }
    handleIncomingMessage(message: any) {
        switch (message.type) {
            case 'media': {
                const { resultId, error, result } = message;
                const promise = this.results[resultId];
                delete this.results[resultId];
                if (!promise) {
                    return;
                }
                if (result) {
                    promise.resolve(result, 'base64');
                }
                else {
                    promise.reject(error);
                }
                break;
            }
        }
    }
}

export interface ScryptedClientStatic extends ScryptedStatic {
    disconnect(): void;
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

                    const systemManager = new SystemManagerImpl(socket, apiUrl, systemState);
                    const mediaManager = new MediaManagerImpl(socket, apiUrl, systemState);

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