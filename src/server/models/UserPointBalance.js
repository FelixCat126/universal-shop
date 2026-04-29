import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'
import User from './User.js'

const UserPointBalance = sequelize.define('UserPointBalance', {
  user_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    references: {
      model: User,
      key: 'id'
    },
    comment: '用户 ID'
  },
  balance: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: '当前可用积分'
  }
}, {
  tableName: 'user_point_balances',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  comment: '用户积分余额（与流水表配合）'
})

User.hasOne(UserPointBalance, { foreignKey: 'user_id', as: 'pointBalance' })
UserPointBalance.belongsTo(User, { foreignKey: 'user_id', as: 'user' })

export default UserPointBalance
