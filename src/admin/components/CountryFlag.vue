<template>
  <span class="country-flag" :title="countryName">
    {{ getFlagEmoji(countryCode) }}
  </span>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  countryCode: {
    type: String,
    required: true
  }
})

const { t } = useI18n()

// 国家代码到国旗emoji的映射
const countryToFlag = {
  '+1': '🇺🇸',    // 美国
  '+7': '🇷🇺',    // 俄罗斯
  '+33': '🇫🇷',   // 法国
  '+44': '🇬🇧',   // 英国
  '+49': '🇩🇪',   // 德国
  '+81': '🇯🇵',   // 日本
  '+82': '🇰🇷',   // 韩国
  '+86': '🇨🇳',   // 中国
  '+65': '🇸🇬',   // 新加坡
  '+66': '🇹🇭',   // 泰国
  '+84': '🇻🇳',   // 越南
  '+60': '🇲🇾',   // 马来西亚
  '+62': '🇮🇩',   // 印度尼西亚
  '+63': '🇵🇭',   // 菲律宾
  '+852': '🇭🇰',  // 香港
  '+853': '🇲🇴',  // 澳门
  '+886': '🇹🇼',  // 台湾
  '+91': '🇮🇳',   // 印度
  '+61': '🇦🇺',   // 澳大利亚
  '+64': '🇳🇿',   // 新西兰
  '+55': '🇧🇷',   // 巴西
  '+52': '🇲🇽',   // 墨西哥
  '+34': '🇪🇸',   // 西班牙
  '+39': '🇮🇹',   // 意大利
  '+31': '🇳🇱',   // 荷兰
  '+46': '🇸🇪',   // 瑞典
  '+47': '🇳🇴',   // 挪威
  '+45': '🇩🇰',   // 丹麦
  '+358': '🇫🇮',  // 芬兰
  '+41': '🇨🇭',   // 瑞士
  '+43': '🇦🇹',   // 奥地利
  '+32': '🇧🇪',   // 比利时
  '+351': '🇵🇹',  // 葡萄牙
  '+30': '🇬🇷',   // 希腊
  '+90': '🇹🇷',   // 土耳其
  '+972': '🇮🇱',  // 以色列
  '+971': '🇦🇪',  // 阿联酋
  '+966': '🇸🇦',  // 沙特阿拉伯
  '+20': '🇪🇬',   // 埃及
  '+27': '🇿🇦'    // 南非
}

// 国家代码到国家名称的映射
const countryNames = {
  '+1': 'United States',
  '+7': 'Russia', 
  '+33': 'France',
  '+44': 'United Kingdom',
  '+49': 'Germany',
  '+81': 'Japan',
  '+82': 'South Korea',
  '+86': 'China',
  '+65': 'Singapore',
  '+66': 'Thailand',
  '+84': 'Vietnam',
  '+60': 'Malaysia',
  '+62': 'Indonesia',
  '+63': 'Philippines',
  '+852': 'Hong Kong',
  '+853': 'Macau',
  '+886': 'Taiwan',
  '+91': 'India',
  '+61': 'Australia',
  '+64': 'New Zealand',
  '+55': 'Brazil',
  '+52': 'Mexico',
  '+34': 'Spain',
  '+39': 'Italy',
  '+31': 'Netherlands',
  '+46': 'Sweden',
  '+47': 'Norway',
  '+45': 'Denmark',
  '+358': 'Finland',
  '+41': 'Switzerland',
  '+43': 'Austria',
  '+32': 'Belgium',
  '+351': 'Portugal',
  '+30': 'Greece',
  '+90': 'Turkey',
  '+972': 'Israel',
  '+971': 'UAE',
  '+966': 'Saudi Arabia',
  '+20': 'Egypt',
  '+27': 'South Africa'
}

const getFlagEmoji = (countryCode) => {
  return countryToFlag[countryCode] || '🌍'
}

const countryName = computed(() => {
  return countryNames[props.countryCode] || 'Unknown Country'
})
</script>

<style scoped>
.country-flag {
  font-size: 16px;
  margin-right: 4px;
  cursor: help;
}
</style>
