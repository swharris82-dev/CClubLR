/**
 * Equipment type routing for Clubhouse IQ.
 *
 * Each profile changes what the Record screen asks for and what the AI is told:
 *   fields      - details captured for this equipment type
 *   safetyLabel - the safety device tracked on the nameplate (LWCO, float, flow switch...)
 *   waterLabel  - what the "water side / piping" notes box is called for this type
 *   loop        - true if this equipment is part of the central plant system
 *   guidance    - diagnostic rules injected into the AI diagnosis
 *   firstMove   - what a competent tech checks before anything else
 *
 * The central plant is one system. Warm rooms on three air handlers and a tower
 * fan stuck at full speed are often the same problem, and the AI is told so.
 */

const PLANT_NOTE = `
- This equipment is part of the club's central plant system. One water-cooled chiller makes chilled water. A cooling tower (VFD fan, bypass valve) and a condenser water pump reject the chiller's heat. A building chilled water pump sends chilled water out. PHX-1, a plate heat exchanger, gives free cooling off the tower when outdoor wet bulb is below about 52 F. Boilers make heating hot water. Chilled and hot water feed multizone air handlers (hot deck and cold deck) and fan coil units across the clubhouse. An Alerton BAS (Ascent Compass) runs the plant.
- Normal chilled water supply is about 44 to 48 F with roughly a 10 F rise across the building. Most of the air handlers date to 1968 and use 3-way coil valves, so the chilled water delta T runs low (3 to 5 F). Low delta T alone is a flow and valve issue, not a chiller failure.
- Plant-wide problems (chiller tripped, chilled water warm, chilled water pump down, tower not making setpoint, boilers down) show up as many rooms on several air handlers and fan coils complaining at once. When complaints span units, put the plant first.
- Condenser water too warm (tower fan, fill, nozzles, approach setpoint, bypass valve) raises chiller head pressure and can trip it on high pressure.
- Check the BAS before trusting it: points in manual override, <NR> (no response) values, and lost communication look like equipment failures. Verify with a thermometer or gauge.
- If other plant equipment has logged problems recently, say so plainly and weigh a plant cause heavily.`;

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
    firstMove: 'Read the lockout or fault on the boiler control, confirm gas pressure and hot water flow, then check the LWCO before resetting anything.',
    guidance: `SYSTEM: Hot water boiler making heating hot water for the air handler hot decks and fan coil heating coils at a country club central plant.
- Always get the lockout or fault message off the burner control or flame safeguard first. Do not guess around a flame failure lockout.
- Common failures: flame rectification (dirty flame rod or scanner), failed igniter, gas valve or low gas pressure, air proving switch or blower, flow switch not made because loop pump is off or air-bound, LWCO tripped, high limit tripped from low flow, condensate trap plugged on condensing boilers, scaled heat exchanger from poor water treatment.
- A high limit trip is almost always a flow problem, not a bad limit. Check the hot water pump, isolation valves, and air in the system before condemning the control.
- Non-condensing boilers (cast iron, copper fin) rot from flue gas condensation if return water runs cold, below about 130 F, for long periods. Check for a bypass or mixing arrangement and the hot water reset schedule.
- Hot water reset matters on this plant: the multizone air handlers mix hot deck and cold deck air, so a hot deck left hot in warm weather wastes boiler and chiller energy at the same time and can overheat zones.
- Never recommend jumping out a safety (LWCO, flow switch, high limit, flame safeguard). Arkansas requires boiler inspection certificates; note if one is expired.
- Carbon monoxide and gas leaks are the safety items. Flag any report of smell, soot, or rollout.${PLANT_NOTE}`
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
    guidance: `SYSTEM: Open cooling tower rejecting the chiller's condenser heat, with a VFD fan and a tower bypass valve, controlled by the BAS.
- The BAS sets condenser water to outdoor wet bulb plus an approach setpoint (5 F is realistic; 2 F is tighter than most towers can reach and pins the fan at 100%). Check the approach setpoint before blaming the tower.
- Summer complaint pattern: condenser water runs warm, chiller head pressure climbs, chiller trips on high pressure or loses capacity, and rooms on every air handler warm up.
- Check which way the bypass valve is actually going (to tower or bypass) at the actuator, not just on the screen.
- In cool weather the tower also feeds PHX-1 for free cooling. Tower trouble then shows up as free cooling not holding chilled water temperature.
- Common failures: broken or slipping fan belt, failed fan motor or bearings, gearbox oil low or failed, VFD fault, spray pump failure (closed-circuit), clogged spray nozzles, fouled fill or coil from scale and biological growth, makeup float valve stuck, basin low, strainer plugged.
- A fouled PHX-1 looks like a bad tower during free cooling. Compare approach temperatures across the HX.
- Winter: freeze damage, basin heater failure, frozen makeup line.
- Water treatment matters here more than anywhere. Scale and biological fouling kill capacity. Legionella is a real risk on open towers; flag any report of slime, odor, or neglected treatment.
- Fall protection and lockout/tagout on fan work. Never reach into a fan deck without the disconnect locked.${PLANT_NOTE}`
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
    guidance: `SYSTEM: Chilled water, condenser water, or heating hot water pump at the central plant.
- A dead building chilled water pump means no cooling anywhere. A dead condenser water pump trips the chiller. A dead hot water pump means no heat. If a standby pump did not pick up, say so and check the lead/lag control.
- Pumps on VFDs: check the drive keypad for Hand/Off/Auto, output Hz, and faults. A drive the BAS cannot talk to may be stuck in Hand or at a fixed speed. Do not switch drive modes without knowing what it runs.
- Common failures: failed coupler on base-mounted pumps (motor spins, pump does not), mechanical seal leak, bearing noise, motor overload trip, VFD fault, clogged suction strainer, air binding, closed or partially closed valve.
- Differential pressure across the pump is the fastest health check. Low differential with the motor running points to a coupler, impeller, or air problem.
- Seal leaks get worse fast and can flood a mechanical room. Treat active leaks as same-day.
- Lock out the motor before touching a coupler guard.${PLANT_NOTE}`
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
    guidance: `SYSTEM: PHX-1, plate and frame heat exchanger for waterside economizer (free cooling) between the condenser water loop and the chilled water loop.
- The BAS starts free cooling when outdoor wet bulb is below about 52 F and stops it if chilled water supply rises above about 58 F. Changeover valves on both sides send water through the HX instead of the chiller; a missing linkage or stuck actuator on those valves means free cooling never works.
- If free cooling will not hold chilled water temperature, check wet bulb, tower water temperature, changeover valve positions, and HX approach in that order.
- A rising approach temperature means fouling on the tower side, which is dirty water. Scale, mud, and biological growth.
- High pressure drop across a side means plugged plates or strainer.
- External leaks usually mean gaskets. Do not over-tighten the frame to stop a leak; it crushes gaskets.
- Cross-contamination (chilled water going dirty) means a plate or gasket failure between sides.${PLANT_NOTE}`
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
    guidance: `SYSTEM: Hydronic accessories on the chilled water and hot water loops (expansion tank, air separator, pressure reducing valve, backflow, relief valves).
- Relief valve weeping or pressure spiking on heat-up points to a waterlogged expansion tank or failed bladder.
- Air noise and low coil flow at attic air handlers point to a failed air separator or vent, or low fill pressure pulling air in at the high points (the attic is the high point here).
- A makeup meter that runs constantly means a leak somewhere on the loop. Say so; that is also diluting water treatment.${PLANT_NOTE}`
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
    guidance: `SYSTEM: Chemical treatment for the cooling tower and the closed chilled water and hot water loops (conductivity controller, bleed valve, chemical pumps, biocide feed, closed-loop inhibitor).
- High conductivity usually means the bleed valve failed closed or the controller probe is fouled.
- Empty drums, lost prime, or a failed feed pump are the common real failures.
- Poor treatment causes the expensive failures elsewhere: scaled chiller condenser tubes (high head pressure), scaled boiler heat exchangers, fouled tower fill, plugged PHX-1, and corroded air handler coils. Link them when the history supports it.
- Chemicals are hazardous. Note PPE and SDS in the truck list.`
  },

  'Water-source heat pump': {
    key: 'wshp',
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
    guidance: `SYSTEM: Water-to-air heat pump. Confirm what water source it is on before ranking; the clubhouse runs a chiller and boiler plant, not a heat pump loop.
- Get the lockout or LED code off the control board first. High pressure, low pressure, freeze protection, and condensate overflow each point somewhere different.
- High pressure lockout in cooling: loop water too hot or too little loop flow is far more likely than a refrigerant problem. Check entering water temperature and the temperature rise across the water coil.
- Low pressure or freeze protection lockout: low airflow (filter, blower, belt), low loop flow, or loop too cold in heating.
- Low flow at one unit only: closed isolation valve, clogged hose kit strainer, failed motorized valve.
- Condensate overflow: plugged drain, failed switch, or no trap. In ceiling units this means water on the ceiling.
- Common mechanical failures: blower motor, reversing valve, compressor contactor or capacitor, and scaled water coils from poor loop treatment.
- Never recommend topping off charge without confirming water side is normal first.`
  },

  'Chiller': {
    key: 'chiller',
    loop: true,
    safetyLabel: 'Flow switches / high pressure cutout',
    waterLabel: 'Evaporator and condenser water connections',
    fields: [
      { id: 'tons', label: 'Tonnage / refrigerant' },
      { id: 'chiller_type', label: 'Compressor type (screw, centrifugal, scroll)' },
      { id: 'design_temps', label: 'Design CHW and condenser water temps' },
      { id: 'panel', label: 'Control panel / BAS interface' },
      { id: 'last_tube', label: 'Last condenser tube cleaning' },
      { id: 'last_oil', label: 'Last oil and refrigerant analysis' }
    ],
    firstMove: 'Read the active fault and alarm history on the chiller panel, then log evaporator and condenser pressures, leaving water temps, and amps before resetting anything.',
    guidance: `SYSTEM: Water-cooled chiller with shell-and-tube evaporator and condenser, the only source of mechanical cooling for the clubhouse.
- Get the fault and alarm history off the chiller's own panel first. The BAS may not be able to read the chiller interface; a BAS run status is not the chiller's own data.
- High pressure or high condenser pressure trips: condenser water too warm (tower), low condenser flow (pump, strainer, valves), or scaled condenser tubes. Check condenser water entering and leaving temps and the tower before the chiller.
- Low pressure or freeze protection trips: low chilled water flow, chilled water setpoint too low, or low refrigerant charge.
- Low chilled water delta T at high flow is a building-side problem (3-way coil valves, valves stuck open, overpumping), not a chiller problem, but it can short cycle the chiller at light load.
- Unusual noise: check amps steady or swinging, oil pressure and temperature, discharge temperature, and surge at light load on centrifugal machines. Do not run a machine that is knocking.
- Water or staining under the shells: check the grooved couplings, flow switch fittings, and drain valves, and rule out condensation on the evaporator before calling it a leak.
- Never bypass flow switches or safeties. Refrigerant work needs EPA certification and a recovery plan.${PLANT_NOTE}`
  },

  'Fan coil unit (hot / chilled water)': {
    key: 'fcu',
    loop: true,
    safetyLabel: 'Condensate switch',
    waterLabel: 'Coil valves, piping, and condensate',
    fields: [
      { id: 'serves', label: 'Area served' },
      { id: 'location', label: 'Where to find it' },
      { id: 'valve', label: 'Coil valves (2-pipe / 4-pipe, 2-way / 3-way)' },
      { id: 'filter_size', label: 'Filter size and count' },
      { id: 'controls', label: 'Controller / BAS point' }
    ],
    firstMove: 'Check the BAS point for the unit (temperature, humidity, NR), then confirm the fan runs and the coil valve opens.',
    guidance: `SYSTEM: Fan coil unit on the club's chilled water and hot water plant (Greenheck LFC and similar), mostly in kitchens, the pool cafe, and the youth center.
- No cooling at one fan coil while others are fine: coil valve or actuator, closed isolation valve, plugged strainer, fan motor, or filter.
- No cooling at every fan coil: the plant. Check chilled water supply temperature first.
- <NR> on the BAS means the controller is offline; the unit may still be running on its last command. A space reading like -148 F is a failed or unplugged sensor, not a frozen room.
- High room humidity (above about 60%) with the fan running means the coil is not getting cold enough water or the valve is not opening. Kitchens add moisture fast.
- Condensate overflow in a ceiling unit means water through the ceiling. Treat it as urgent.${PLANT_NOTE}`
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

  'Air handling unit (AHU)': {
    key: 'ahu',
    loop: true,
    safetyLabel: 'Condensate float / freeze stat',
    waterLabel: 'Coil piping and condensate',
    fields: [
      { id: 'serves', label: 'Areas served' },
      { id: 'location', label: 'Where to find it' },
      { id: 'coil', label: 'Coil type (hot water, chilled water, loop, DX) and valve' },
      { id: 'filter_size', label: 'Filter size and count' },
      { id: 'belt', label: 'Belt size' },
      { id: 'motor', label: 'Blower motor HP / VFD' },
      { id: 'mau', label: 'Make-up air unit tied to it' },
      { id: 'controls', label: 'Controls / thermostat' }
    ],
    firstMove: 'Confirm the blower is running and moving air: belt, filter, motor, then check coil water or refrigerant temps and the control valve.',
    guidance: `SYSTEM: Central air handling unit on the club's chilled water and hot water plant, serving several rooms in an older clubhouse. Units sit in attics, the boiler room, and back rooms, so access takes time; note the location from the record in the truck list.
- Most clubhouse units (AHU-2, 3, 4, 5, 10) are multizone: one fan blows through a hot deck (hot water coil) and a cold deck (chilled water coil), and a damper for each zone mixes the two. On the BAS, zone 2-5 means AHU-2, zone 5.
- Zone too warm or too cold while other zones on the same unit are fine: that zone's damper. Check the actuator moves, the linkage and shaft are tight, and the blade position matches the command. Confirm which way 0% and 100% go.
- All zones on one unit off: deck temperatures. Cold deck should run near 55 F in cooling; a 63 F cold deck will not cool or dehumidify. A hot deck near 95 F on a warm day means the hot deck reset is not working and the unit is heating and cooling at once.
- A zone in vent mode with a fixed damper position can still be fed mostly hot deck air. Check the vent position against the deck temperatures.
- Many units are 1968 Porter / Marlo builds with no OEM parts. Replace belts, sheaves, bearings, and motors by measured size. Treat old pipe and fitting insulation, duct flex connectors, and mastic as possible asbestos; do not disturb it.
- Pneumatic gauges on some panels are leftovers from the old Honeywell controls; the Alerton BAS now runs these units.
- One AHU serves several rooms. If several rooms on the same AHU complain at once, the problem is at the AHU, not the rooms. If only one room complains, look at that room's damper, diffuser, or thermostat first.
- Airflow first: broken or slipping belt, plugged filter, failed blower motor or bearings, closed or failed dampers, VFD fault.
- Then heat transfer: coil fouled, control valve stuck or actuator failed, no water flow or wrong water temperature to the coil, or low refrigerant if it is a DX coil. Verify which coil type this unit has before ranking.
- A tripped freeze stat or condensate float shuts the unit down and looks like a dead unit. Check those before condemning a motor.
- Attic units: condensate overflow means water through a ceiling. Treat any water call under an attic AHU as urgent.
- If the unit is tied to a make-up air unit, a MAU problem can push hot or humid outside air into the space and look like an AHU failure.${PLANT_NOTE}`
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
    guidance: `SYSTEM: Alerton BAS (Ascent Compass front end) for the central plant, air handlers, fan coils, exhaust fans, and walk-in temperature monitoring.
- <NR> on a point means no response: the controller or drive is offline or lost communication. Several <NR> points at once (for example the chiller interface and a VFD) point to a network trunk problem, not separate failures.
- Readings like -148 F mean a failed, open, or unplugged sensor.
- Points in manual override (chiller forced on, a zone forced occupied) hide the real control problem. Find out who set it and why before releasing it.
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
  return ['vrf', 'ductless', 'boiler', 'wshp', 'ice', 'chiller'].includes(k);
}

module.exports = { PROFILES, getProfile, listTypes, requiresErrorCode, DEFAULT_TYPE };
