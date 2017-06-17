const should     = require('should')
const Assertion  = should.Assertion

Assertion.add('kk', function() {
    this.obj.should.have.property('id').which.is.a.Number()
    this.obj.should.have.property('path')
})
Assertion.alias('equal', '等于')

describe('加法函数的测试', () => {
    it('1 加 1 应该等于 2', () => {
        const asset = {
            id: 1,
            path: '/a/b'
        }
        asset.should.kk()
    })
})