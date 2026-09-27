/**
 * Equipment type routing for Clubhouse IQ.
 *
 * Each profile changes what the Record screen asks for and what the AI is told:
 *   fields      - details captured for this equipment type
 *   safetyLabel - the safety device tracked on the nameplate (LWCO, float, flow switch...)
 *   waterLabel  - what the "water side / piping" notes box is called for this type
 *   loop        - true if this equipment is part of the building water loop
 *   guidance    - diagnostic rules injected into the AI diagnosis
 *   firstMove   - what a competent tech checks before anything else
 *
 * The water loop is one system. A heat pump lockout in the dining room and a
 * dead tower fan in the plant are often the same problem, and the AI is told so.
 */

const LOOP_NOTE = `
- This equipment is part of the club's water-source heat pump loop: boilers add heat in winter, the cooling tower rejects heat in summer, loop pumps move water to every heat pump in every building.
- Normal loop supply is roughly 60 to 90 F. A loop running hot in summer (tower side) or cold in winter (boiler side) will lock out heat pumps across multiple buildings at once.
- Low loop flow (pump failure, air in the loop, closed valve, clogged strainer) causes heat pump lockouts that look like individual unit failures.
- If several heat pumps have faulted recently, or any central plant equipment has open problems, say so plainly and put the loop first.`;

const PROFILES = {
  'Boiler (loop heat)': {
    key: 'boiler',
    loop: true,
    safetyLabel: 'Low water cutoff',
    waterLabel: 'Water side, piping, and venting',
    fields: [
      { id: 'input_mbh', label: 'Input MBH / fuel' },
      { id: 'boiler_style', label: 'Style (cast iron, copper fin, firetube, condensing)' },
      { id: 'setpoint', label: 'Operating setpoint / reset schedule' },
      { id: 'lead_lag', label: 'Lead / lag position' },
      { id: 'lwco_type', label: 'LWCO type and last test date' },
      { id: 'state_cert', label: 'State boiler inspection certificate expires' },
      { id: 'last_combustion', label: 'Last combustion analysis' }
    ],
    firstMove: 'Read the lockout or fault on the boiler control, confirm gas pressure and loop flow, then check the LWCO before resetting anything.',
    guidance: `SYSTEM: Hot water boiler providing heat to a water-source heat pump loop at a country club central plant.
- Always get the lockout or fault message off the burner control or flame safeguard first. Do not guess around a flame failure lockout.
- Common failures: flame rectification (dirty flame rod or scanner), failed igniter, gas valve or low gas pressure, air proving switch or blower, flow switch not made because loop pump is off or air-bound, LWCO tripped, high limit tripped from low flow, condensate trap plugged on condensing boilers, scaled heat exchanger from poor water treatment.
- A high limit trip is almost always a flow problem, not a bad limit. Check the loop pump, isolation valves, and air in the system before condemning the control.
- Non-condensing boilers (cast iron, copper fin) rot from flue gas condensation if return water runs cold, below about 130 F, for long periods. On a heat pump loop running 60 to 90 F this is a real risk; check for a bypass or mixing arrangement.
- Never recommend jumping out a safety (LWCO, flow switch, high limit, flame safeguard). Arkansas requires boiler inspection certificates; note if one is expired.
- Carbon monoxide and gas leaks are the safety items. Flag any report of smell, soot, or rollout.${LOOP_NOTE}`
  },

  'Cooling tower / fluid cooler': {
    key: 'tower',
    loop: true,
    safetyLabel: 'Vibration / basin level switch',
    waterLabel: 'Basin, makeup, bleed, and piping',
    fields: [
      { id: 'tower_type', label: 'Open tower + HX, or closed-circuit fluid cooler' },
      { id: 'fan_drive', label: 'Fan drive (belt / gearbox), HP, VFD' },
      { id: 'spray_pump', label: 'Spray pump (closed-circuit) HP' },
      { id: 'basin_heater', label: 'Basin heater / freeze protection' },
      { id: 'chem_vendor', label: 'Water treatment vendor' },
      { id: 'last_clean', label: 'Last basin cleaning / inspection' }
    ],
    firstMove: 'Confirm the fan is actually turning and the water is actually flowing over the fill or coil, then check the VFD and basin level.',
    guidance: `SYSTEM: Cooling tower or closed-circuit fluid cooler rejecting heat from the heat pump loop.
- Summer complaint pattern: the loop runs hot, heat pumps across the club trip on high head pressure. The tower is the first suspect when multiple buildings complain at once.
- Common failures: broken or slipping fan belt, failed fan motor or bearings, gearbox oil low or failed, VFD fault, spray pump failure (closed-circuit), clogged spray nozzles, fouled fill or coil from scale and biological growth, makeup float valve stuck, basin low, strainer plugged.
- Open towers with a plate heat exchanger: a fouled heat exchanger looks like a bad tower. Compare approach temperatures across the HX.
- Winter: freeze damage, basin heater failure, frozen makeup line.
- Water treatment matters here more than anywhere. Scale and biological fouling kill capacity. Legionella is a real risk on open towers; flag any report of slime, odor, or neglected treatment.
- Fall protection and lockout/tagout on fan work. Never reach into a fan deck without the disconnect locked.${LOOP_NOTE}`
  },

  'Loop / condenser pump': {
    key: 'pump',
    loop: true,
    safetyLabel: 'Flow switch / proof of flow',
    waterLabel: 'Seal, strainer, valves, and piping',
    fields: [
      { id: 'hp_gpm', label: 'HP / GPM / head' },
      { id: 'pump_style', label: 'Style (base-mount, inline, end suction)' },
      { id: 'lead_lag', label: 'Lead / lag position' },
      { id: 'vfd', label: 'VFD or across-the-line' },
      { id: 'seal', label: 'Seal type / last replaced' }
    ],
    firstMove: 'Check whether the pump is running, then look at the gauges across it and the coupler before anything else.',
    guidance: `SYSTEM: Circulating pump on the heat pump loop or the tower condenser water side.
- A dead loop pump takes down every heat pump on the loop. If the standby pump did not pick up, say so and check the lead/lag control.
- Common failures: failed coupler on base-mounted pumps (motor spins, pump does not), mechanical seal leak, bearing noise, motor overload trip, VFD fault, clogged suction strainer, air binding, closed or partially closed valve.
- Differential pressure across the pump is the fastest health check. Low differential with the motor running points to a coupler, impeller, or air problem.
- Seal leaks get worse fast and can flood a mechanical room. Treat active leaks as same-day.
- Lock out the motor before touching a coupler guard.${LOOP_NOTE}`
  },

  'Plate heat exchanger': {
    key: 'hx',
    loop: true,
    safetyLabel: 'Differential pressure alarm',
    waterLabel: 'Gaskets, strainers, and piping',
    fields: [
      { id: 'hx_model', label: 'Plate count / frame size' },
      { id: 'design_temps', label: 'Design entering / leaving temps' },
      { id: 'last_opened', label: 'Last opened and cleaned' }
    ],
    firstMove: 'Log entering and leaving temperatures on both sides and compare the approach to design.',
    guidance: `SYSTEM: Plate and frame heat exchanger separating an open cooling tower from the closed heat pump loop.
- A rising approach temperature means fouling on the tower side, which is dirty water. Scale, mud, and biological growth.
- High pressure drop across a side means plugged plates or strainer.
- External leaks usually mean gaskets. Do not over-tighten the frame to stop a leak; it crushes gaskets.
- Cross-contamination (loop water going dirty) means a plate or gasket failure between sides.${LOOP_NOTE}`
  },

  'Loop accessory (expansion tank, air separator, makeup)': {
    key: 'accessory',
    loop: true,
    safetyLabel: 'Relief valve',
    waterLabel: 'Fill pressure, makeup, and piping',
    fields: [
      { id: 'fill_psi', label: 'Fill / static pressure' },
      { id: 'tank_type', label: 'Tank type (bladder, plain steel)' },
      { id: 'prv', label: 'Makeup PRV setting' }
    ],
    firstMove: 'Check loop static pressure and the expansion tank charge before blaming anything else for pressure swings.',
    guidance: `SYSTEM: Hydronic loop accessories (expansion tank, air separator, pressure reducing valve, backflow, relief valves).
- Relief valve weeping or pressure spiking on heat-up points to a waterlogged expansion tank or failed bladder.
- Air noise and heat pump flow faults across the club point to a failed air separator or vent, or low fill pressure pulling air in at high points.
- A makeup meter that runs constantly means a leak somewhere on the loop. Say so; that is also diluting water treatment.${LOOP_NOTE}`
  },

  'Water treatment system': {
    key: 'chem',
    loop: true,
    safetyLabel: 'Controller alarm',
    waterLabel: 'Chemical feed, bleed, and test results',
    fields: [
      { id: 'vendor', label: 'Treatment vendor / rep' },
      { id: 'cond_setpoint', label: 'Conductivity / bleed setpoint' },
      { id: 'last_test', label: 'Last test results and date' },
      { id: 'biocide', label: 'Biocide program' }
    ],
    firstMove: 'Check the controller for alarms, confirm chemical drums are not empty, and verify the bleed valve actually opens.',
    guidance: `SYSTEM: Chemical treatment for the cooling tower and closed loop (conductivity controller, bleed valve, chemical pumps, biocide feed, closed-loop inhibitor).
- High conductivity usually means the bleed valve failed closed or the controller probe is fouled.
- Empty drums, lost prime, or a failed feed pump are the common real failures.
- Poor treatment causes the expensive failures elsewhere: scaled boiler heat exchangers, fouled tower fill, plugged plate heat exchanger, corroded heat pump coils. Link them when the history supports it.
- Chemicals are hazardous. Note PPE and SDS in the truck list.`
  },

  'Water-source heat pump': {
    key: 'wshp',
    loop: true,
    safetyLabel: 'Condensate switch',
    waterLabel: 'Condensate, hoses, and loop valves',
    fields: [
      { id: 'serves', label: 'Area served' },
      { id: 'tons', label: 'Tonnage' },
      { id: 'access', label: 'Access (closet, ceiling, attic)' },
      { id: 'filter_size', label: 'Filter size' },
      { id: 'controller', label: 'Control board / thermostat' },
      { id: 'last_fault', label: 'Last lockout / LED code' }
    ],
    firstMove: 'Read the lockout code on the control board, then check loop water temperature and flow at the unit before touching the refrigerant side.',
    guidance: `SYSTEM: Water-to-air heat pump on the club's building water loop.
- Get the lockout or LED code off the control board first. High pressure, low pressure, freeze protection, and condensate overflow each point somewhere different.
- High pressure lockout in cooling: loop water too hot or too little loop flow is far more likely than a refrigerant problem. Check entering water temperature and the temperature rise across the water coil.
- Low pressure or freeze protection lockout: low airflow (filter, blower, belt), low loop flow, or loop too cold in heating.
- Low flow at one unit only: closed isolation valve, clogged hose kit strainer, failed motorized valve.
- Condensate overflow: plugged drain, failed switch, or no trap. In ceiling units this means water on the ceiling.
- Common mechanical failures: blower motor, reversing valve, compressor contactor or capacitor, and scaled water coils from poor loop treatment.
- Never recommend topping off charge without confirming water side is normal first.${LOOP_NOTE}`
  },

  'Rooftop / package unit': {
    key: 'package',
    safetyLabel: 'Condensate / smoke detector',
    waterLabel: 'Condensate and curb',
    fields: [
      { id: 'serves', label: 'Area served' },
      { id: 'tons', label: 'Tonnage / heat MBH' },
      { id: 'roof_access', label: 'Roof / curb access notes' },
      { id: 'filter_size', label: 'Filter size' },
      { id: 'econo', label: 'Economizer present?' }
    ],
    firstMove: 'Confirm safe roof access and power before climbing with tools.',
    guidance: `SYSTEM: Packaged rooftop or ground-mount unit (gas heat or heat pump), all components in one cabinet. Common on large open spaces like indoor tennis.
- Weigh electrical and refrigerant failures (capacitor, contactor, low charge), plus economizer linkage and actuator faults, belt-driven blower issues, gas heat section faults (igniter, flame sensor, inducer, pressure switch), and curb or drain pan corrosion.
- Large open spaces with high ceilings lose humidity control fast. Flag short cycling and oversized equipment.
- Access and safety: note ladder, roof access, and fall protection in the truck list.`
  },

  'Split system / air handler': {
    key: 'split',
    safetyLabel: 'Float switch',
    waterLabel: 'Condensate drain',
    fields: [
      { id: 'serves', label: 'Area served' },
      { id: 'breaker_loc', label: 'Breaker / disconnect location' },
      { id: 'filter_size', label: 'Filter size' },
      { id: 'tstat_model', label: 'Thermostat model' }
    ],
    firstMove: 'Filter, breaker, float switch, then capacitor and contactor at the condenser.',
    guidance: `SYSTEM: Conventional split system with indoor air handler or furnace and outdoor condenser.
- Most no-cool calls resolve to: dirty filter or coil, tripped float switch, failed run capacitor, pitted contactor, low charge from a leak, or a failed blower motor.
- Order checks cheapest and most likely first.
- If the report mentions ice on the lineset, treat airflow restriction and low charge as the top two, in that order.`
  },

  'Ductless mini-split': {
    key: 'ductless',
    safetyLabel: 'Condensate pump / switch',
    waterLabel: 'Condensate',
    fields: [
      { id: 'serves', label: 'Area served' },
      { id: 'indoor_model', label: 'Indoor head model' },
      { id: 'outdoor_model', label: 'Outdoor unit model' },
      { id: 'last_error', label: 'Last error / blink code seen' }
    ],
    firstMove: 'Read the error code off the head or outdoor board before touching anything.',
    guidance: `SYSTEM: Ductless mini-split.
- ALWAYS start with the fault code. If none was given, the first instruction is to retrieve it.
- Water from an indoor head is usually a dirty blower wheel or a plugged drain, not refrigerant.
- Most inverter units have no start capacitor. Never rank a board failure first unless a code points there.`
  },

  'VRF / VRV': {
    key: 'vrf',
    safetyLabel: 'Condensate switch',
    waterLabel: 'Condensate and piping',
    fields: [
      { id: 'outdoor_id', label: 'Outdoor unit / system ID' },
      { id: 'branch_ctrl', label: 'Branch controller and port' },
      { id: 'indoor_addr', label: 'Indoor unit address' },
      { id: 'last_error', label: 'Last error code' }
    ],
    firstMove: 'Pull the error code and the system address. Never diagnose a VRF head in isolation.',
    guidance: `SYSTEM: VRF / VRV. A networked system, not a standalone unit.
- The error code is mandatory.
- Faults on one head are often upstream: branch controller, transmission wiring, addressing, outdoor module.
- Refrigerant charge is calculated from piping length. Never suggest topping off.`
  },

  'Walk-in cooler / freezer': {
    key: 'walkin',
    safetyLabel: 'Temperature alarm',
    waterLabel: 'Drain line, door, and gaskets',
    fields: [
      { id: 'box', label: 'Cooler or freezer, box size' },
      { id: 'setpoint', label: 'Setpoint' },
      { id: 'condensing', label: 'Condensing unit location' },
      { id: 'defrost', label: 'Defrost type and schedule' }
    ],
    firstMove: 'Read box temperature, check the evaporator for ice, and make sure the condensing unit is running and its coil is clean.',
    guidance: `SYSTEM: Commercial kitchen walk-in cooler or freezer.
- Food safety drives priority. A box above 41 F (cooler) or rising in a freezer is same-day or emergency; tell the kitchen to move product.
- Common failures: dirty condenser coil, iced evaporator from failed defrost (heater, termination switch, timer), door left open or bad gaskets, failed evaporator fan motor, drain line frozen on freezers, low charge, failed condenser fan.
- Kitchen grease loads condensers fast. Coil cleaning is the cheap fix that usually matters.`
  },

  'Ice machine': {
    key: 'ice',
    safetyLabel: 'Water / bin level control',
    waterLabel: 'Water supply, filter, and drain',
    fields: [
      { id: 'head_bin', label: 'Head and bin model' },
      { id: 'cooling', label: 'Air or water cooled' },
      { id: 'filter', label: 'Water filter and last change' },
      { id: 'last_clean', label: 'Last descale / sanitize' }
    ],
    firstMove: 'Check for a fault light or code on the head, confirm water supply and filter, then look at the evaporator for scale.',
    guidance: `SYSTEM: Commercial ice machine.
- Scale is the top cause of slow production and harvest problems. Little Rock water plus a neglected filter means frequent descaling.
- Other common failures: water inlet valve, clogged water filter, dirty condenser (air cooled), harvest assist or thickness probe issues, bin control, drain clogs.
- Ice machines are food equipment. Sanitize after any service and flag slime or mold.`
  },

  'Kitchen equipment': {
    key: 'kitchen',
    safetyLabel: 'Hood suppression / gas shutoff',
    waterLabel: 'Water, gas, and drain connections',
    fields: [
      { id: 'appliance', label: 'Appliance type' },
      { id: 'fuel', label: 'Gas or electric' },
      { id: 'service_co', label: 'Service company on contract' }
    ],
    firstMove: 'Confirm power or gas supply and read any error display before opening panels.',
    guidance: `SYSTEM: Commercial kitchen equipment (ranges, ovens, fryers, dishmachines, hoods, grease trap).
- Get the error display or symptom exactly. Gas appliances: pilot, thermocouple, igniter, gas valve. Dishmachines: heater, wash pump, chemical feed, rinse temperature.
- Hood fire suppression systems are inspected and serviced by licensed contractors only. Never recommend adjusting them.
- Flag gas smell, electrical burning, and scald hazards as safety items.`
  },

  'Pool equipment': {
    key: 'pool',
    safetyLabel: 'Suction / entrapment protection',
    waterLabel: 'Filter, chemistry, and plumbing',
    fields: [
      { id: 'pump_hp', label: 'Pump HP / VFD' },
      { id: 'filter_type', label: 'Filter type (sand, DE, cartridge)' },
      { id: 'heater', label: 'Heater / heat pump' },
      { id: 'chem', label: 'Chlorination / controller' }
    ],
    firstMove: 'Check pump prime and filter pressure, then chemistry, before assuming a failed component.',
    guidance: `SYSTEM: Pool mechanical (pump, filter, heater, chemical controller) at the pool pavilion.
- Common failures: pump losing prime from suction air leaks, clogged pump basket or skimmers, high filter pressure needing backwash, heater ignition or flow switch faults, chemical controller probe fouling.
- Water chemistry problems are health code problems. Flag them.
- Entrapment protection (VGB drain covers, SVRS) is a safety item.`
  },

  'Water heater': {
    key: 'dhw',
    safetyLabel: 'T&P relief valve',
    waterLabel: 'Water and venting',
    fields: [
      { id: 'capacity', label: 'Gallons / input' },
      { id: 'fuel', label: 'Gas or electric' },
      { id: 'serves', label: 'Serves (kitchen, locker rooms)' }
    ],
    firstMove: 'Confirm gas or power, read any fault code on the control, then check the burner or elements.',
    guidance: `SYSTEM: Commercial domestic hot water heater.
- Common failures: pilot or ignition, flame sensor, thermocouple, gas valve, element burnout (electric), sediment, failed mixing valve, recirc pump.
- Kitchen hot water must meet health code temperatures for dish sanitation. Treat loss of kitchen hot water as same-day.
- Flag T&P discharge, venting problems, and scald risk as safety items.`
  },

  'Building controls / BAS': {
    key: 'bas',
    safetyLabel: 'Alarm status',
    waterLabel: 'Network and panel notes',
    fields: [
      { id: 'platform', label: 'Platform (JCI, Honeywell, Trane, Siemens...)' },
      { id: 'panel', label: 'Panel / controller location' },
      { id: 'vendor', label: 'Controls vendor' }
    ],
    firstMove: 'Check the alarm log and whether the point is in override or hand before trusting what the screen says.',
    guidance: `SYSTEM: Building automation / controls for the central plant and heat pumps.
- Many "equipment failures" are points left in override, failed sensors, or lost communication.
- Verify with a meter or thermometer before acting on a sensor value.
- A comm loss to many devices at once is a network or power problem, not many failures.`
  },

  'Other': {
    key: 'other',
    safetyLabel: 'Safety device',
    waterLabel: 'Water / drain notes',
    fields: [{ id: 'system_notes', label: 'Describe the equipment' }],
    firstMove: 'Identify the equipment before diagnosing.',
    guidance: `SYSTEM: Not specified. Ask for equipment identification first and keep recommendations conservative until the equipment type is known.`
  }
};

const DEFAULT_TYPE = 'Other';

function getProfile(systemType) {
  return PROFILES[systemType] || PROFILES[DEFAULT_TYPE];
}

function listTypes() {
  return Object.keys(PROFILES);
}

// Types where a fault or lockout code should be demanded before mechanical checks.
function requiresErrorCode(systemType) {
  const k = getProfile(systemType).key;
  return ['vrf', 'ductless', 'boiler', 'wshp', 'ice'].includes(k);
}

module.exports = { PROFILES, getProfile, listTypes, requiresErrorCode, DEFAULT_TYPE };
