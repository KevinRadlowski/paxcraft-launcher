import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { BootstrapService } from './core/services/bootstrap.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<router-outlet />`,
  styles: [`:host { display: block; height: 100%; }`],
})
export class AppComponent implements OnInit {
  private readonly bootstrap = inject(BootstrapService);

  ngOnInit(): void {
    void this.bootstrap.initialize();
  }
}
