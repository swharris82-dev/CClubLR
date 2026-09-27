/**
 * System type routing.
 *
 * Each profile changes three things:
 *   fields   - what the Unit Record asks for on this system type
 *   guidance - diagnostic rules injected into the triage prompt
 *   firstMove- what a competent tech checks before anything else
 *
 * The guidance is the important part. A VRF fault and a split-system fault
 * with identical symptoms have almost nothing in common diagnostically, and a
 * generic model will happily give you split-system advice on a VRF call.
 */

const PROFILES = {
  'Split system / air handler': {
    key: 'split',
    fields: [
      { id: 'breaker_loc', label: 'Breaker / disconnect location' },
      { id: 'filter_size', label: 'Filter size' },
      { id: 'tstat_model', label: 'Thermostat model' }
    ],
    firstMove: 'Filter, breaker, float switch, then capacitor and contactor at the condenser.',
    guidance: `SYSTEM: Conventional split system with indoor air handler and outdoor condenser.
- Most no-cool calls on this equipment resolve to: dirty filter/coil, tripped float switch, failed run capacitor, pitted contactor, low charge from a leak, or a failed blower motor/ECM module.
- Order the checks cheapest-and-most-likely first: filter, float switch, breaker, then capacitor microfarad reading, then contactor, then pressures.
- Do NOT recommend error-code lookups; this equipment generally has no fault display beyond thermostat behavior and board LEDs.
- If the report mentions ice on the lineset, treat airflow restriction and low charge as the top two, in that order.
- Capacitor and contactor are cheap truck stock. Recommend carrying them.`
  },

  'Ceiling mount air handler': {
    key: 'ceiling',
    fields: [
      { id: 'access_notes', label: 'Access (attic hatch, closet, ceiling panel)' },
      { id: 'pan_type', label: 'Secondary pan present?' },
      { id: 'filter_size', label: 'Filter size' }
    ],
    firstMove: 'Condensate before anything else. Ceiling mounts flood living space when they fail.',
    guidance: `SYSTEM: Ceiling-mounted / horizontal air handler in a multifamily unit.
- Condensate is the dominant failure mode and the expensive one, because overflow lands in the ceiling below and becomes a drywall claim, not just a service call.
- Horizontal pans hold standing water. Rank drain clog, trap issues, insufficient pitch, and float switch failure at the top for ANY water, stain, or ceiling complaint.
- Float switch placement matters: a switch mounted at the opposite end of the pan from the drain may never trip before the pan overflows. If the unit record notes this, say so explicitly and treat the switch as non-protective regardless of whether it "works."
- Access is a real cost. Note it in the truck list (ladder, panel removal, drop cloth).
- If the report is water-related and this unit has prior condensate history, treat it as a recurring design defect, not a new clog.`
  },

  'Ductless mini-split': {
    key: 'ductless',
    fields: [
      { id: 'indoor_model', label: 'Indoor head model' },
      { id: 'outdoor_model', label: 'Outdoor unit model' },
      { id: 'drain_type', label: 'Gravity drain or condensate pump' },
      { id: 'last_error', label: 'Last error / blink code seen' }
    ],
    firstMove: 'Read the error code off the head or outdoor board before touching anything.',
    guidance: `SYSTEM: Ductless mini-split (single or multi-head).
- ALWAYS start with the fault code. These systems self-report, and blindly checking mechanical items wastes a trip. If no code was given, the first instruction should be to retrieve it from the indoor display, blink pattern, or outdoor board.
- Common ductless-specific failures: clogged blower wheel (causes water spitting from the head, frequently misreported as a "leak"), failed condensate pump, dirty indoor coil, communication error between indoor and outdoor, failed indoor thermistor, EEV sticking.
- Water dripping from an indoor head is usually a dirty blower wheel or a plugged drain line, NOT an overcharge. Rank accordingly.
- Do not recommend "check the capacitor" style split-system diagnostics; most inverter units have no start capacitor.
- Inverter boards are expensive and often misdiagnosed. Never rank a board failure first unless a code specifically indicates it.
- Manufacturer matters. If the model is LG, Mitsubishi, Daikin, or Fujitsu, reference that brand's code convention when relevant.`
  },

  'VRF / VRV': {
    key: 'vrf',
    fields: [
      { id: 'outdoor_id', label: 'Outdoor unit / system ID' },
      { id: 'branch_ctrl', label: 'Branch controller & port #' },
      { id: 'indoor_addr', label: 'Indoor unit address' },
      { id: 'last_error', label: 'Last error code' },
      { id: 'piping_notes', label: 'Piping / riser notes' }
    ],
    firstMove: 'Pull the error code and the system address. Never diagnose a VRF head in isolation.',
    guidance: `SYSTEM: VRF / VRV. Treat this as a networked system, not a standalone unit.
- The error code is mandatory. Without it, the correct first instruction is to retrieve the code from the indoor unit, the branch controller, or the outdoor board — not to start checking components.
- A fault on one indoor head is frequently caused by something upstream: branch controller port, transmission wiring, address conflict, or an outdoor module. Always consider whether other units on the same system are also affected, and say so.
- VRF-specific failure modes to weigh: EEV sticking or failed coil, transmission/communication wiring fault (often shielding or termination), address duplication, oil return problems on long risers, branch controller solenoid failure, refrigerant charge error relative to piping length.
- Do NOT apply split-system logic. There is no contactor or run capacitor to check on the indoor side, and pressure readings are interpreted very differently.
- Refrigerant charge on VRF is calculated from actual piping length. Never suggest "top it off."
- Flag when a fault pattern suggests the problem is systemic (multiple heads, one branch controller, one riser) rather than local — that is the single most valuable call on this equipment and the one most often missed.
- If work on one head requires shutting down the system, note the tenant impact in the truck list.`
  },

  'Package unit': {
    key: 'package',
    fields: [
      { id: 'roof_access', label: 'Roof / curb access notes' },
      { id: 'filter_size', label: 'Filter size' },
      { id: 'econo', label: 'Economizer present?' }
    ],
    firstMove: 'Confirm safe roof access and power before climbing with tools.',
    guidance: `SYSTEM: Packaged rooftop or ground-mount unit, all components in one cabinet.
- Weigh the same electrical and refrigerant failure modes as a split system, plus: economizer linkage and actuator faults, belt-driven blower issues, and curb/drain pan corrosion.
- Access and safety are real factors. Note ladder, roof access, and fall considerations in the truck list.
- Condensate drains on packaged units back-pitch and rot at the pan more often than on indoor equipment.`
  },

  'Other': {
    key: 'other',
    fields: [{ id: 'system_notes', label: 'Describe the system' }],
    firstMove: 'Identify the equipment before diagnosing.',
    guidance: `SYSTEM: Not specified. Ask for equipment identification as the first step, and keep all recommendations conservative and non-destructive until the system type is known.`
  }
};

const DEFAULT_TYPE = 'Split system / air handler';

function getProfile(systemType) {
  return PROFILES[systemType] || PROFILES[DEFAULT_TYPE];
}

function listTypes() {
  return Object.keys(PROFILES);
}

// Types where a fault code should be demanded before mechanical checks.
function requiresErrorCode(systemType) {
  const k = getProfile(systemType).key;
  return k === 'vrf' || k === 'ductless';
}

module.exports = { PROFILES, getProfile, listTypes, requiresErrorCode, DEFAULT_TYPE };
