import { spec } from '@cxl/spec';
import cli from './index.js';

export default spec('gbx', s => {
	s.test('should load', a => {
		a.ok(cli);
	});
});
