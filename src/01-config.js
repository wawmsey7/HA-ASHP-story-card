
// ---------- 1. config ----------
const MIN = 60000, HOUR = 3600e3, DAY = 86400e3;

// Only what the hub really reports. (The old sensor.heating_period guessed Day/Night and flickered, so it's
// not used; the room graph shows the day and night temps as references until the plan provides the real one.)
const DEFAULT_ENTITIES = {
  activity: 'sensor.heat_pump_activity_log',      // Heating, Hot water, Defrost, Paused, Oil return (Off)
  satisfied: 'binary_sensor.thermostat_setback',  // the room thermostat is satisfied, so the water is lowered
  target: 'sensor.target_flow_temp_2',
  flow: 'sensor.actual_flow_temp_2',
  return: 'sensor.actual_return_temp_2',
  room: 'sensor.room_thermostat_temp',
  outside: 'sensor.exterior_weather_sensor',
  power: 'sensor.heat_pump_electrical_power_2',   // kW in
  heat: 'sensor.heat_pump_thermal_power_2',       // kW out (as the hub reports it)
  meter: 'sensor.ashp_power_usage',               // kWh running total (electricity meter)
  day_temp: 'sensor.circuit_1_comfort_day_temp',
  night_temp: 'sensor.circuit_1_eco_night_temp',
  curve: 'sensor.weather_comp_curve',
  shift: 'sensor.curve_shift',
  room_factor: 'sensor.room_temperature_correction',
  setback_size: 'sensor.circuit_1_temp_reduction',
  hyst: 'sensor.circuit_1_hysteresis_2',
  dhw_target: 'sensor.dhw_target_temp_setting',
  desired: 'sensor.c1_desired_heating_lwt_2',
  tank: 'sensor.actual_dhw_temp_2',
  tank_pct: 'sensor.hot_water_remaining',
  flow_rate: 'sensor.flow_rate_2',
  compressor: 'sensor.compressor_frequency_2',
  cop: 'sensor.cop_real',
  weather: 'weather.forecast_home',
  plan: '',                                        // later: the plan's sensor (state = set temp or "off")
};
// option names from the old story card that mean the same thing here
const OLD_KEYS = { at_temp: 'satisfied', energy: 'meter' };
const DEFAULT_SCRIPTS = {
  curve: 'script.grant_set_weather_curve',
  shift: 'script.grant_set_curve_shift',
  room_factor: 'script.grant_set_room_temp_correction',
  day_temp: 'script.grant_set_daytemp_target',
  night_temp: 'script.grant_set_nighttemp_target',
  setback_size: 'script.grant_set_temp_reduction',
};

// the zoom chips
const SPAN_LIST = [3, 6, 12, 24, 72, 168].map(h => h * HOUR);
const SPAN_NAME = new Map([[3 * HOUR, '3h'], [6 * HOUR, '6h'], [12 * HOUR, '12h'], [24 * HOUR, '24h'], [72 * HOUR, '3d'], [168 * HOUR, '7d']]);
const MIN_SPAN = 30 * MIN, MAX_SPAN = 7 * DAY, MAX_BACK = 14 * DAY;
const BRIDGE = 10 * MIN;            // hub dropouts shorter than this are bridged, longer ones show as a gap

// graphs, top to bottom. The first three are the main ones; the rest can be switched on.
const GRAPHS = {
  water: { label: 'Water', h: 164 },
  room: { label: 'Room', h: 64 },
  outside: { label: 'Outside', h: 44 },
  power: { label: 'Power', h: 52 },
  cop: { label: 'COP', h: 44 },
  tank: { label: 'Hot water tank', h: 52 },
  flow_rate: { label: 'Flow rate', h: 40 },
  compressor: { label: 'Compressor', h: 40 },
};
const CORE_GRAPHS = ['water', 'room', 'outside'];
const EXTRA_GRAPHS = ['power', 'cop', 'tank', 'flow_rate', 'compressor'];

// readings outside these are hub glitches (e.g. 32.8 kW) and are skipped
const LIMITS = { power: [0, 10], heat: [0, 25], compressor: [0, 150], flow_rate: [0, 80], cop: [0, 15], tank_pct: [0, 100], meter: [0, 1e9],
  curve: [0, 10], shift: [-30, 30], room_factor: [0, 20], setback_size: [0, 30], hyst: [0, 10] };
const TEMP_LIMITS = [-40, 95];
const NUMERIC = ['target', 'flow', 'return', 'room', 'outside', 'power', 'heat', 'meter', 'day_temp', 'night_temp', 'curve', 'shift',
  'room_factor', 'setback_size', 'hyst', 'dhw_target', 'desired', 'tank', 'tank_pct', 'flow_rate', 'compressor', 'cop'];
// settings: a change shows as a mark on the time axis
const SETTINGS = [['curve', 'Weather curve', 1, ''], ['shift', 'Curve shift', 0, ' °C'], ['room_factor', 'Room correction', 1, ''],
  ['day_temp', 'Day temperature', 1, ' °C'], ['night_temp', 'Night temperature', 1, ' °C'], ['setback_size', 'Setback', 0, ' °C'],
  ['dhw_target', 'Hot water target', 0, ' °C']];
const RENAME = { Circulating: 'Paused', Idle: 'Off', Standby: 'Off', Stopped: 'Off' };
const RUNNING = ['Heating', 'Hot water', 'Defrost', 'Oil return'];
const STORE_PREFIX = 'hp-history:';
