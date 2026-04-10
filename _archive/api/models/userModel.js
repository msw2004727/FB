// api/models/userModel.js

const DEFAULT_USER_FIELDS = {
    // 【核心修正】移除 money 欄位
    internalPower: 5,
    externalPower: 5,
    lightness: 5,
    morality: 0,
    stamina: 100,
    bulkScore: 0,
    isDeceased: false,
    equipment: {
        head: null,
        body: null,
        hands: null,
        feet: null,
        weapon_right: null,
        weapon_left: null,
        weapon_back: null,
        accessory1: null,
        accessory2: null,
        manuscript: null,
    },
    maxInternalPowerAchieved: 5,
    maxExternalPowerAchieved: 5,
    maxLightnessAchieved: 5,
    customSkillsCreated: {
        internal: 0,
        external: 0,
        lightness: 0,
        none: 0
    },
    shortActionCounter: 0,
};

module.exports = {
    DEFAULT_USER_FIELDS,
};
