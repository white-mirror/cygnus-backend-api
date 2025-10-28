import axios, { AxiosInstance, AxiosResponse } from "axios";

export const BASE_URL = "https://bgh-services.solidmation.com";
export const API_URL = `${BASE_URL}/1.0`;
export const LOGIN_ENDPOINT = `${BASE_URL}/control/LoginPage.aspx/DoStandardLogin`;
export const DEFAULT_TIMEOUT_MS = 15_000;

export const FAN_MODES: Record<string, number> = {
  low: 1,
  mid: 2,
  high: 3,
  auto: 254,
  no_change: 255,
};

export const HVAC_MODES: Record<string, number> = {
  off: 0,
  cool: 1,
  heat: 2,
  dry: 3,
  fan_only: 4,
  auto: 254,
  no_change: 255,
};

const VALUE_TYPE_TEMPERATURE = 13;
const VALUE_TYPE_MODE = 14;
const VALUE_TYPE_FAN_SPEED = 15;
const VALUE_TYPE_TARGET_TEMPERATURE = 20;

type JsonObject = Record<string, unknown>;

type RawEndpointValue = {
  ValueType?: number;
  Value?: unknown;
} & JsonObject;

type RawEndpointValueGroup = {
  Values?: unknown;
} & JsonObject;

type RawEndpoint = {
  EndpointID?: number;
  Description?: string;
} & JsonObject;

type RawDevice = {
  DeviceModel?: string | null;
  Address?: string | null;
} & JsonObject;

export class BGHApiError extends Error {
  public readonly response?: AxiosResponse;

  constructor(message: string, response?: AxiosResponse) {
    super(message);
    this.name = "BGHApiError";
    this.response = response;
  }
}

export class BGHAuthenticationError extends BGHApiError {
  constructor(message: string, response?: AxiosResponse) {
    super(message, response);
    this.name = "BGHAuthenticationError";
  }
}

export class DeviceStatus {
  constructor(
    public readonly deviceId: number,
    public readonly deviceName: string,
    public readonly model: string | null | undefined,
    public readonly serialNumber: string | null | undefined,
    public readonly temperature: number | null,
    public readonly targetTemperature: number | null,
    public readonly fanSpeed: number | null,
    public readonly modeId: number | null,
    public readonly rawValues: RawEndpointValue[],
    public readonly rawDevice: RawDevice,
    public readonly endpoint: RawEndpoint,
  ) {}

  toJSON(): JsonObject {
    return {
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      model: this.model ?? null,
      serialNumber: this.serialNumber ?? null,
      temperature: this.temperature,
      targetTemperature: this.targetTemperature,
      fanSpeed: this.fanSpeed,
      modeId: this.modeId,
    };
  }
}

type TokenPayload = {
  Token: string;
} & JsonObject;

export interface BGHClientOptions {
  httpClient?: AxiosInstance;
  timeoutMs?: number;
}

export type HomeSummary = JsonObject;
export type DeviceStatusMap = Record<number, DeviceStatus>;

export class BGHClient {
  private readonly http: AxiosInstance;
  private readonly timeoutMs: number;
  private token?: TokenPayload;
  private readonly tokenPromise: Promise<TokenPayload>;

  constructor(email: string, password: string, options: BGHClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.http = options.httpClient ?? axios.create({ timeout: this.timeoutMs });
    this.tokenPromise = this.login(email, password);
  }

  async listHomes(): Promise<HomeSummary[]> {
    const endpoint = `${API_URL}/HomeCloudService.svc/EnumHomes`;
    const response = await this.post(endpoint);
    const data = this.extractJson(response, "home enumeration");
    const homes = (data.EnumHomesResult as JsonObject | undefined)?.Homes;
    return (Array.isArray(homes) ? homes : []) as HomeSummary[];
  }

  async getDevices(homeId: number): Promise<DeviceStatusMap> {
    const dataPacket = await this.getDataPacket(homeId);
    return this.parseDevices(dataPacket);
  }

  async getDeviceStatus(
    homeId: number,
    deviceId: number,
  ): Promise<DeviceStatus> {
    const devices = await this.getDevices(homeId);
    const device = devices[deviceId];
    if (!device) {
      throw new BGHApiError(`Device ${deviceId} not found for home ${homeId}`);
    }
    return device;
  }

  async setMode(
    deviceId: number,
    {
      mode,
      targetTemperature,
      fan = "auto",
      flags = 255,
    }: {
      mode: keyof typeof HVAC_MODES;
      targetTemperature: number;
      fan?: keyof typeof FAN_MODES;
      flags?: number;
    },
  ): Promise<JsonObject> {
    if (!(mode in HVAC_MODES)) {
      throw new Error(`Unsupported HVAC mode '${mode}'`);
    }
    if (!(fan in FAN_MODES)) {
      throw new Error(`Unsupported fan mode '${fan}'`);
    }

    const endpoint = `${API_URL}/HomeCloudCommandService.svc/HVACSetModes`;
    const payload: JsonObject = {
      desiredTempC: String(targetTemperature),
      fanMode: FAN_MODES[fan],
      flags,
      mode: HVAC_MODES[mode],
      endpointID: deviceId,
    };

    const response = await this.post(endpoint, payload);
    const data = this.extractJson(response, "set mode");
    return data;
  }

  private async ensureToken(): Promise<TokenPayload> {
    if (!this.token) {
      this.token = await this.tokenPromise;
    }
    return this.token;
  }

  private async login(email: string, password: string): Promise<TokenPayload> {
    try {
      const response = await this.http.post(LOGIN_ENDPOINT, {
        user: email,
        password,
      });
      const data = this.extractJson(response, "authentication");
      const token = data.d;

      if (!token) {
        throw new BGHAuthenticationError(
          "Missing authentication token",
          response,
        );
      }

      if (typeof token === "string") {
        return { Token: token };
      }

      if (typeof token === "object" && token !== null && "Token" in token) {
        const tokenValue = (token as JsonObject).Token;
        if (typeof tokenValue === "string") {
          return {
            ...(token as JsonObject),
            Token: tokenValue,
          } as TokenPayload;
        }
      }

      throw new BGHAuthenticationError(
        "Unexpected authentication token format",
        response,
      );
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        throw new BGHAuthenticationError(
          `Authentication failed with status ${error.response.status}`,
          error.response,
        );
      }
      throw error;
    }
  }

  private async post(
    endpoint: string,
    payload: JsonObject = {},
  ): Promise<AxiosResponse> {
    const token = await this.ensureToken();
    const body: JsonObject = { ...payload };

    const existingToken = body.token as JsonObject | undefined;
    body.token = {
      ...(existingToken ?? {}),
      Token: token.Token,
    };

    try {
      return await this.http.post(endpoint, body);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const { response } = error;
        if (response) {
          throw new BGHApiError(
            `Request to ${endpoint} failed with status ${response.status}`,
            response,
          );
        }
        throw new BGHApiError(
          `Request to ${endpoint} failed: ${error.message}`,
        );
      }
      throw error;
    }
  }

  private extractJson(response: AxiosResponse, context: string): JsonObject {
    const { data } = response;
    if (data === null || data === undefined || typeof data !== "object") {
      throw new BGHApiError(
        `Unable to parse ${context} response as JSON`,
        response,
      );
    }
    return data as JsonObject;
  }

  private async getDataPacket(homeId: number): Promise<JsonObject> {
    const endpoint = `${API_URL}/HomeCloudService.svc/GetDataPacket`;
    const payload: JsonObject = {
      homeID: homeId,
      serials: {
        Home: 0,
        Groups: 0,
        Devices: 0,
        Endpoints: 0,
        EndpointValues: 0,
        Scenes: 0,
        Macros: 0,
        Alarms: 0,
      },
      timeOut: 10_000,
    };

    const response = await this.post(endpoint, payload);
    const data = this.extractJson(response, "data packet");
    return (data.GetDataPacketResult as JsonObject | undefined) ?? {};
  }

  private parseDevices(data: JsonObject): DeviceStatusMap {
    const endpoints = (data.Endpoints as RawEndpoint[] | undefined) ?? [];
    const endpointValues =
      (data.EndpointValues as RawEndpointValueGroup[] | undefined) ?? [];
    const devicesMeta = (data.Devices as RawDevice[] | undefined) ?? [];

    const devices: DeviceStatusMap = {};

    for (let index = 0; index < endpoints.length; index += 1) {
      const endpoint = endpoints[index];
      const valuesGroup = endpointValues[index];
      const metadata = devicesMeta[index];

      if (!endpoint) {
        continue;
      }

      const endpointId = endpoint.EndpointID;
      if (typeof endpointId !== "number") {
        continue;
      }

      const values = this.normaliseValues(valuesGroup);
      const parsed = this.parseRawValues(values);

      devices[endpointId] = new DeviceStatus(
        endpointId,
        endpoint.Description ?? "",
        metadata?.DeviceModel,
        metadata?.Address,
        parsed.temperature,
        parsed.targetTemperature,
        parsed.fanSpeed,
        parsed.modeId,
        values,
        metadata ?? {},
        endpoint,
      );
    }

    return devices;
  }

  private normaliseValues(
    valuesGroup?: RawEndpointValueGroup,
  ): RawEndpointValue[] {
    const values = valuesGroup?.Values;
    if (!Array.isArray(values)) {
      return [];
    }
    return values.filter(
      (item): item is RawEndpointValue =>
        typeof item === "object" && item !== null,
    );
  }

  private parseRawValues(values: RawEndpointValue[]): {
    temperature: number | null;
    targetTemperature: number | null;
    fanSpeed: number | null;
    modeId: number | null;
  } {
    const findValue = (valueType: number): unknown => {
      for (const item of values) {
        if (item.ValueType === valueType) {
          return item.Value;
        }
      }
      return undefined;
    };

    let temperature: number | null = null;
    const temperatureValue = findValue(VALUE_TYPE_TEMPERATURE);
    if (
      typeof temperatureValue === "number" ||
      typeof temperatureValue === "string"
    ) {
      const numericTemperature = Number(temperatureValue);
      if (!Number.isNaN(numericTemperature)) {
        temperature = numericTemperature <= -50 ? null : numericTemperature;
      }
    }

    let targetTemperature: number | null = null;
    const targetTemperatureValue = findValue(VALUE_TYPE_TARGET_TEMPERATURE);
    if (
      typeof targetTemperatureValue === "number" ||
      typeof targetTemperatureValue === "string"
    ) {
      const numericTargetTemperature = Number(targetTemperatureValue);
      if (!Number.isNaN(numericTargetTemperature)) {
        targetTemperature =
          numericTargetTemperature === 255 ? 20 : numericTargetTemperature;
      }
    }

    let fanSpeed: number | null = null;
    const fanSpeedValue = findValue(VALUE_TYPE_FAN_SPEED);
    if (
      typeof fanSpeedValue === "number" ||
      typeof fanSpeedValue === "string"
    ) {
      const numericFanSpeed = Number(fanSpeedValue);
      fanSpeed = Number.isNaN(numericFanSpeed) ? null : numericFanSpeed;
    }

    let modeId: number | null = null;
    const modeValue = findValue(VALUE_TYPE_MODE);
    if (typeof modeValue === "number" || typeof modeValue === "string") {
      const numericMode = Number(modeValue);
      modeId = Number.isNaN(numericMode) ? null : numericMode;
    }

    return { temperature, targetTemperature, fanSpeed, modeId };
  }
}
