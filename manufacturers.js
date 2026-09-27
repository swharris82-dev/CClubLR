/**
 * Manufacturer-specific diagnostic logic.
 *
 * System type tells you HOW the equipment works.
 * Manufacturer tells you how THIS BRAND fails, what its codes mean, and where
 * its known weak points are. Both get injected into the triage prompt.
 *
 * `families` maps a brand to the system types it's relevant for, so the picker
 * only offers Mitsubishi on a ductless/VRF unit and Goodman on a split.
 */

const MANUFACTURERS = {
  /* ---------- Ducted / conventional ---------- */

  'Carrier': {
    families: ['split', 'ceiling', 'package'],
    codes: 'Amber LED flash codes on the furnace/air handler control board; Infinity systems report alphanumeric codes at the wall control.',
    guidance: `CARRIER: Board LED flash codes are the primary diagnostic on ducted equipment — count the flashes before pulling panels. Infinity/Greenspeed communicating systems will not run correctly on a conventional thermostat and will throw comms faults if one was swapped in; always confirm the thermostat matches the system. Known weak points: inducer motor bearings, pressure switch hoses collecting condensate, and control board relay failure on older 58/59 series. Carrier and Bryant equipment are the same platform with different badges.`
  },
  'Bryant': {
    families: ['split', 'ceiling', 'package'],
    codes: 'Same LED flash-code system as Carrier; Evolution controls report alphanumeric codes.',
    guidance: `BRYANT: Mechanically identical to Carrier — same boards, same flash codes, same failure profile, and Carrier parts cross-reference directly. Evolution is the Bryant name for Carrier Infinity communicating controls and carries the same thermostat-compatibility trap.`
  },
  'Payne': {
    families: ['split', 'package'],
    codes: 'Carrier-family LED flash codes.',
    guidance: `PAYNE: Carrier's budget line. Same flash codes and cross-referenced parts, but lighter-duty components — expect earlier capacitor, contactor, and blower motor failure than the Carrier-badged equivalent. Cheap to repair, so recommend replacement of wear parts rather than testing marginal ones.`
  },
  'Trane': {
    families: ['split', 'ceiling', 'package', 'vrf'],
    codes: 'LED codes on the UC board; ComfortLink II and XL communicating controls display alphanumeric codes at the thermostat.',
    guidance: `TRANE: Spine Fin outdoor coils are easy to damage during cleaning — never recommend high-pressure washing. Communicating ComfortLink systems require matched indoor/outdoor equipment and a Trane thermostat; mismatched components throw comms faults that look like board failures. Known weak points: TXV failures on some XR/XB series, and variable-speed blower module failures on the indoor side. Trane and American Standard are the same equipment.`
  },
  'American Standard': {
    families: ['split', 'ceiling', 'package'],
    codes: 'Same as Trane — UC board LEDs and communicating control codes.',
    guidance: `AMERICAN STANDARD: Same manufacturer and platform as Trane. Parts cross-reference directly and the failure profile is identical. Treat any Trane diagnostic guidance as applying here.`
  },
  'Lennox': {
    families: ['split', 'ceiling', 'package'],
    codes: 'Seven-segment display on most control boards showing two-character alphanumeric codes; iComfort systems report at the thermostat.',
    guidance: `LENNOX: Read the seven-segment board display directly — it is more specific than flash codes. Major practical issue in multifamily: many Lennox parts are dealer-restricted and not available at general supply houses, so verify part availability before promising a same-day fix. Known weak points: secondary heat exchanger cracking on some Pulse and G-series furnaces, and iComfort thermostat comms faults after power events.`
  },
  'Goodman': {
    families: ['split', 'ceiling', 'package'],
    codes: 'Red LED flash codes on the integrated control module; some models use a two-digit display.',
    guidance: `GOODMAN: Extremely common in multifamily because of cost. Diagnostics are conventional and parts are cheap and widely stocked. Known weak points: original-equipment run capacitors failing early (check microfarads before anything else on a no-start), control board relay failure, and evaporator coil leaks on pre-2015 units — coils were a known warranty issue, so ALWAYS check the registered warranty before quoting a coil. Goodman, Amana, and Daikin ducted share the same platform post-acquisition.`
  },
  'Amana': {
    families: ['split', 'ceiling', 'package'],
    codes: 'Same LED flash codes as Goodman.',
    guidance: `AMANA: Goodman platform with a longer warranty and slightly upgraded components. Same diagnostics, same parts cross-reference. The warranty difference is the practical one — Amana often carries lifetime compressor or heat exchanger coverage on the original owner, so check registration before condemning major components.`
  },
  'Rheem': {
    families: ['split', 'ceiling', 'package'],
    codes: 'LED flash codes on the control board; EcoNet systems display alphanumeric codes.',
    guidance: `RHEEM: Conventional diagnostics. Known weak points: blower motor module failures on variable-speed models, and pressure switch issues from condensate in the hose on high-efficiency furnaces. EcoNet communicating systems require matched components. Rheem and Ruud are the same equipment.`
  },
  'Ruud': {
    families: ['split', 'ceiling', 'package'],
    codes: 'Same as Rheem.',
    guidance: `RUUD: Identical to Rheem — same platform, same codes, same parts. Apply Rheem guidance directly.`
  },
  'York': {
    families: ['split', 'ceiling', 'package'],
    codes: 'LED flash codes on the control board; some models use a status display.',
    guidance: `YORK: Johnson Controls family, shared with Coleman and Luxaire. Known weak points: contactor and capacitor failures, and evaporator coil leaks on certain mid-2000s models. Parts availability is good but model-year specific — confirm the full model number before ordering.`
  },
  'Coleman': {
    families: ['split', 'package'],
    codes: 'York-family flash codes.',
    guidance: `COLEMAN: York/Johnson Controls platform. Same codes, parts cross-reference to York. Common in manufactured and light commercial applications.`
  },
  'Heil / ICP': {
    families: ['split', 'package'],
    codes: 'LED flash codes on the ICP control board.',
    guidance: `HEIL / ICP: International Comfort Products family, which also covers Tempstar, Comfortmaker, and Arcoaire — all the same equipment with different badges, and parts cross-reference across all of them. Conventional diagnostics. Known weak point: control board and inducer failures.`
  },
  'Nortek / Nordyne': {
    families: ['split', 'package'],
    codes: 'LED flash codes; limited self-diagnostics on older units.',
    guidance: `NORTEK / NORDYNE: Covers Maytag, Frigidaire, Gibson, and Westinghouse HVAC badges. Common in manufactured housing and budget multifamily. Diagnostics are basic and often require manual component testing rather than code reading. Parts can be harder to source locally — verify availability early.`
  },
  'Bosch': {
    families: ['split', 'ceiling', 'ductless'],
    codes: 'Alphanumeric fault codes at the control board or wall control.',
    guidance: `BOSCH: Inverter-driven ducted equipment behaves more like a ductless system than a conventional split — do not apply contactor/capacitor logic to the inverter models. Read the fault code. Known weak point: inverter board sensitivity to voltage irregularities and surge events.`
  },

  /* ---------- Ductless / VRF ---------- */

  'Mitsubishi Electric': {
    families: ['ductless', 'vrf'],
    codes: 'Two-character alphanumeric codes (e.g. P8, U8, E6, 6607) shown at the wall controller, indoor LED blink pattern, or outdoor board seven-segment display.',
    guidance: `MITSUBISHI ELECTRIC: Codes are the entire diagnostic path — do not proceed without one. Key code families: E-series are communication and address errors between indoor and outdoor; U-series are outdoor unit protection faults (U8 fan, UF compressor overcurrent); P-series are indoor sensor and drain faults (P8 pipe temperature, P5 drain pump). 6607 specifically means no communication received and usually points to transmission wiring, a terminated shield problem, or an address conflict rather than a failed board.
City Multi (VRF) uses M-NET addressing — a duplicated address will produce faults on units that are themselves fine. On CITY MULTI, always check whether other indoor units on the same branch controller or refrigerant system are also faulting before condemning anything local.
Known weak points: drain pumps on wall-mount heads, and thermistors reading out of range causing intermittent shutdowns. Mitsubishi boards are expensive; never rank a board first without a code that specifically indicates it.`
  },
  'LG': {
    families: ['ductless', 'vrf'],
    codes: 'Two-digit numeric codes (e.g. CH 05, CH 06, CH 21, CH 38) at the wall controller or indoor display; Multi V systems report at the outdoor unit and central controller.',
    guidance: `LG: CH-prefixed numeric codes. CH 05 is a communication error between indoor and outdoor — check transmission wiring, polarity, and terminating resistor before suspecting boards. CH 06 is indoor pipe sensor. CH 21 and CH 22 are inverter/compressor current faults. CH 38 and other outdoor codes generally require reading at the outdoor board.
Multi V (VRF) uses a setting-based addressing scheme; DIP switch and auto-addressing errors are a frequent cause of faults on units that are mechanically fine. On Multi V, verify whether the fault is isolated or system-wide before doing any component work.
Known weak points: PCB failures after voltage events, indoor blower wheel fouling causing water spray from wall-mount heads (frequently misreported as a refrigerant leak), and LGRED heat-mode faults in low ambient. LG parts often require model-specific ordering — confirm the full model and serial before sourcing.`
  },
  'Daikin': {
    families: ['ductless', 'vrf', 'split'],
    codes: 'Two-character codes (e.g. U4, E7, A6, L5) shown at the remote controller, indoor display, or outdoor seven-segment.',
    guidance: `DAIKIN: Codes follow a letter-number scheme. U-codes are system and communication faults (U4 is indoor-to-outdoor transmission, a wiring or addressing issue far more often than a board). E-codes are outdoor unit faults. A-codes are indoor unit faults. L-codes are inverter faults. F-codes are refrigerant/temperature abnormalities.
VRV systems require correct refrigerant charge calculated from actual piping length — never top off, and treat charge-related codes as requiring a full charge calculation. VRV also stores fault history at the outdoor board, which is worth pulling on intermittent complaints.
Known weak points: EEV coil failures causing temperature control problems that mimic charge issues, and outdoor fan motor faults. Daikin also owns Goodman/Amana; Daikin-badged DUCTED equipment may use the Goodman platform, so confirm which you are looking at.`
  },
  'Fujitsu': {
    families: ['ductless', 'vrf'],
    codes: 'Numeric codes read from indoor LED blink counts or displayed at the controller; Airstage VRF reports at the outdoor board.',
    guidance: `FUJITSU: Retrieve the code from the indoor unit LED blink pattern (operation and timer lights blink in a counted sequence) or the wired controller. Communication faults between indoor and outdoor are common after power events and usually trace to wiring rather than components.
Airstage VRF uses address-based commissioning; addressing errors present as faults on healthy units. Known weak points: indoor thermistors and drain pump failures on cassette units.`
  },
  'Samsung': {
    families: ['ductless', 'vrf'],
    codes: 'E-prefixed numeric codes (e.g. E101, E201, E458) at the indoor display or wired controller.',
    guidance: `SAMSUNG: E1xx codes are communication errors (E101 is indoor-outdoor comms, typically wiring or addressing). E2xx are indoor unit faults. E4xx are outdoor and inverter faults. DVM VRF systems auto-address on commissioning and will fault system-wide if addressing is disturbed — verify tracking before component work.
Known weak points: inverter PCB failures and EEV coil faults. Parts availability in the US is weaker than Mitsubishi or LG; confirm sourcing before committing to a repair timeline.`
  },
  'Panasonic': {
    families: ['ductless', 'vrf'],
    codes: 'H- and F-prefixed codes (e.g. H11, F91) at the controller or via indoor LED sequence.',
    guidance: `PANASONIC: H-codes generally indicate sensor and communication faults; F-codes indicate refrigerant cycle and inverter abnormalities. H11 is an indoor-outdoor communication error, usually wiring. Retrieve the code before any mechanical diagnosis. Known weak point: indoor thermistors and outdoor fan motor faults.`
  },
  'Toshiba-Carrier': {
    families: ['ductless', 'vrf'],
    codes: 'Alphanumeric codes at the wired controller or outdoor seven-segment display.',
    guidance: `TOSHIBA-CARRIER: VRF platform sold under both badges in North America. Codes are read at the wired controller. Communication and addressing faults are the most common presentation. Verify whether other indoor units on the same system are affected before local component work.`
  },
  'Hitachi': {
    families: ['ductless', 'vrf'],
    codes: 'Alarm codes displayed at the controller or outdoor unit.',
    guidance: `HITACHI: Alarm codes are the primary diagnostic. Communication and address faults dominate on multi-head and VRF systems. Parts sourcing in the US is limited — confirm availability early on any component replacement.`
  },
  'Gree': {
    families: ['ductless'],
    codes: 'Alphanumeric codes (e.g. E1, E5, F1, H6) at the indoor display.',
    guidance: `GREE: Budget ductless, common in retrofit and value multifamily installs. E1 is high pressure protection, E5 is overcurrent/low voltage, H6 is indoor fan motor feedback loss. Known weak points: indoor fan motors, PCB failures, and factory flare joints leaking — on a low-charge complaint, check the flares at the head before assuming a line-set leak. Parts support is thin; replacement of the head is sometimes cheaper than repair.`
  },
  'Midea': {
    families: ['ductless'],
    codes: 'Alphanumeric codes at the indoor display; also manufactures for several other badges.',
    guidance: `MIDEA: Manufactures under many private labels, so an unfamiliar ductless brand is frequently a rebadged Midea and codes may cross-reference. Similar profile to Gree: flare leaks, indoor fan motor faults, and PCB sensitivity. Verify parts availability before promising a repair.`
  },
  'Pioneer': {
    families: ['ductless'],
    codes: 'Alphanumeric codes at the indoor display.',
    guidance: `PIONEER: Import ductless, frequently DIY-installed. Because installs are often non-professional, weigh installation defects heavily: improper flare joints, insufficient vacuum leading to moisture in the system, undersized line sets, and missing condensate pitch. On any complaint, evaluate the install before the equipment.`
  },

  /* ---------- Fallback ---------- */

  'Other / Unknown': {
    families: ['split', 'ceiling', 'ductless', 'vrf', 'package', 'other'],
    codes: 'Unknown — identify from the data plate.',
    guidance: `MANUFACTURER NOT IDENTIFIED: Instruct the tech to pull the full model and serial from the data plate before ordering parts or condemning components. Keep recommendations generic to the system type and avoid brand-specific code interpretation.`
  }
};

function listManufacturers(systemKey) {
  const out = [];
  for (const [name, m] of Object.entries(MANUFACTURERS)) {
    if (!systemKey || m.families.includes(systemKey)) out.push({ name, codes: m.codes });
  }
  return out;
}

function getManufacturer(name) {
  return MANUFACTURERS[name] || null;
}

module.exports = { MANUFACTURERS, listManufacturers, getManufacturer };
