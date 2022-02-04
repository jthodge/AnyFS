import { AnyFSProvider } from "./provider";
import { AnyFSReader } from "./reader";
import { AnyFSWriter } from "./writer";
import { AnyFSFile } from "./fs-file";
import { AnyFSFolder } from "./fs-folder";
import { ObjectID, AnyFSObjectRaw, AnyFSFolderMetadata } from "./internal-types";

export class AnyFS {
	_AESKey: Buffer;
	_cache = new Map<ObjectID, AnyFSObjectRaw<any>>();
	_FSProvider: AnyFSProvider;
	chunkSize: number;
	
	private _rootObjectID: ObjectID;
	private _currentReaders = new Set<AnyFSReader>();
	private _currentWriter: AnyFSWriter = null;
	private _awaitingReaders = new Set<Function>();
	private _awaitingWriters = new Array<Function>();

	_getRead() {
		return new Promise<AnyFSReader>((resolve) => {
			if (this._currentWriter == null) {
				const reader = new AnyFSReader(this);
				this._currentReaders.add(reader);
				resolve(reader);
				return;
			}
			this._awaitingReaders.add(resolve);
		});
	}

	private _resolveNextWriter() {
		const resolve = this._awaitingWriters.shift();
		if (resolve == null) {
			return;
		}
		this._currentWriter = new AnyFSWriter(this);
		resolve(this._currentWriter);
	}

	_getWrite() {
		return new Promise<AnyFSWriter>((resolve) => {
			this._awaitingWriters.push(resolve);
			if (this._currentReaders.size === 0) {
				this._resolveNextWriter();
			}
		});
	}

	_release(readerOrWriter: AnyFSReader | AnyFSWriter) {
		if (this._currentWriter === readerOrWriter) {
			this._currentWriter = null;
			const willResolve = this._awaitingReaders;
			this._awaitingReaders = new Set();
			for (const resolve of willResolve) {
				const reader = new AnyFSReader(this);
				this._currentReaders.add(reader);
				resolve(reader);
			}
		}
		else {
			this._currentReaders.delete(readerOrWriter);
		}
		if (this._currentReaders.size === 0) {
			this._resolveNextWriter();
		}
	}

	async atPath(path: string): Promise<AnyFSFile | AnyFSFolder> {
		return await (await this.root()).atPath(path);
	}
	
	async root(): Promise<AnyFSFolder> {
		// Initialize if necessary
		let reader: AnyFSReader = await this._getRead();
		try {
			await reader.readObject(this._rootObjectID);
		}
		catch {
			reader.release();
			const writer = await this._getWrite();
			reader = writer;
			await writer.writeObject<AnyFSFolderMetadata>(this._rootObjectID, {
				metadata: {
					type: "folder",
					entries: []
				},
				data: null
			});
		}
		finally {
			reader.release();
		}
		return new AnyFSFolder(this, null, "/", this._rootObjectID);
	}

	constructor(FSProvider: AnyFSProvider, AESKey: Buffer, chunkSize: number, rootID: ObjectID) {
		this._FSProvider = FSProvider;
		this._AESKey = AESKey;
		this._rootObjectID = rootID;
		this.chunkSize = chunkSize;
	}
}